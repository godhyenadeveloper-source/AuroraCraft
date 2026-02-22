/**
 * Server-side build pipeline runner.
 * Mirrors the client-side build-engine.ts but runs entirely on the server,
 * persisting state to the database after every step.
 *
 * Uses EventEmitter for SSE streaming to connected clients.
 */

import { EventEmitter } from "events";
import { storage } from "./storage";
import { callAIServer } from "./ai-helper";
import {
  buildPlanningPrompt,
  buildFileGenerationPrompt,
  buildPatchPrompt,
  buildReviewPrompt,
  buildSummaryPrompt,
  buildContinuationPrompt,
  buildFileReadPrompt,
  buildAgenticStepPrompt,
} from "@shared/build-prompts";
import type { Build } from "@shared/schema";

// ─── Types ───────────────────────────────────────────────────────────────

interface BuildPlan {
  pluginName: string;
  packageName: string;
  description: string;
  phases: { name: string; description: string; files: { path: string; name: string; description: string }[] }[];
}

interface PhaseState {
  name: string;
  description: string;
  status: "pending" | "active" | "reviewing" | "complete";
  files: FileState[];
}

interface FileState {
  path: string;
  name: string;
  description: string;
  status: "pending" | "generating" | "created" | "updating" | "updated"
        | "reading" | "read" | "deleting" | "deleted" | "error";
  error?: string;
}

export type BuildEvent =
  | { type: "planning" }
  | { type: "plan-ready"; plan: BuildPlan }
  | { type: "plan-approved" }
  | { type: "conversation-response"; content: string }
  | { type: "quick-change-start"; description: string; files: { path: string; name: string; description: string }[] }
  | { type: "phase-start"; phaseIndex: number }
  | { type: "file-generating"; phaseIndex: number; fileIndex: number }
  | { type: "file-updating"; phaseIndex: number; fileIndex: number }
  | { type: "file-created"; phaseIndex: number; fileIndex: number; path: string }
  | { type: "file-updated"; phaseIndex: number; fileIndex: number; path: string }
  | { type: "file-error"; phaseIndex: number; fileIndex: number; error: string }
  | { type: "file-reading"; phaseIndex: number; fileIndex: number }
  | { type: "file-read"; phaseIndex: number; fileIndex: number; path: string }
  | { type: "file-deleting"; phaseIndex: number; fileIndex: number }
  | { type: "file-deleted"; phaseIndex: number; fileIndex: number; path: string }
  | { type: "dynamic-file"; phaseIndex: number; file: FileState }
  | { type: "phase-reviewing"; phaseIndex: number }
  | { type: "phase-complete"; phaseIndex: number }
  | { type: "build-complete"; summary: string }
  | { type: "build-error"; error: string }
  | { type: "thinking"; message: string }
  | { type: "snapshot"; state: any };

const MAX_RETRIES = 2;
const RETRY_DELAYS = [500, 2000];
const MAX_CONTINUATIONS = 3;

// Active build runners keyed by build ID
const activeRunners = new Map<number, BuildRunner>();

export function getRunner(buildId: number): BuildRunner | undefined {
  return activeRunners.get(buildId);
}

// ─── BuildRunner ─────────────────────────────────────────────────────────

export class BuildRunner {
  public buildId: number;
  public emitter = new EventEmitter();
  private abortController = new AbortController();
  private fileMemory = new Map<string, string>();
  private fileIdMap = new Map<string, number>();
  private modelId: number = 0;
  private sessionId: number = 0;
  private framework: string = "paper";
  private plan: BuildPlan | null = null;
  private phases: PhaseState[] = [];

  // Promise + resolver for awaiting user approval
  private approvalResolve: ((result: { action: string; editInstructions?: string }) => void) | null = null;
  // Promise + resolver for file error decisions
  private fileErrorResolve: ((decision: string) => void) | null = null;
  // Track pending file error for snapshot restoration on reconnect
  private pendingFileError: { filePath: string; error: string } | null = null;

  constructor(buildId: number) {
    this.buildId = buildId;
    activeRunners.set(buildId, this);
    this.emitter.setMaxListeners(50);
  }

  cancel(): void {
    this.abortController.abort();
    activeRunners.delete(this.buildId);
  }

  resolveApproval(result: { action: string; editInstructions?: string }): void {
    if (this.approvalResolve) {
      this.approvalResolve(result);
      this.approvalResolve = null;
    }
  }

  resolveFileError(decision: string): void {
    if (this.fileErrorResolve) {
      this.fileErrorResolve(decision);
      this.fileErrorResolve = null;
      this.pendingFileError = null;
    }
  }

  getSnapshot(): any {
    return {
      buildId: this.buildId,
      sessionId: this.sessionId,
      plan: this.plan,
      phases: this.phases,
      status: "building",
      pendingFileError: this.pendingFileError,
    };
  }

  async start(buildId: number): Promise<void> {
    const build = await storage.getBuild(buildId);
    if (!build) throw new Error("Build not found");

    this.buildId = buildId;
    this.sessionId = build.sessionId!;
    this.modelId = build.modelId!;
    this.framework = build.framework || "paper";

    // Load existing files into memory
    await this.loadExistingFiles();

    try {
      await this.planPhase(build.userRequest);
    } catch (e: any) {
      if (e.message === "Build cancelled" || this.abortController.signal.aborted) {
        this.emit({ type: "build-error", error: "Build was cancelled" });
        await this.updateBuildState({ status: "cancelled" });
      } else {
        this.emit({ type: "build-error", error: this.sanitizeError(e.message || "Build failed") });
        await this.updateBuildState({ status: "error", error: e.message || "Build failed" });
      }
    } finally {
      activeRunners.delete(this.buildId);
    }
  }

  async resume(buildId: number): Promise<void> {
    const build = await storage.getBuild(buildId);
    if (!build) throw new Error("Build not found");

    this.buildId = buildId;
    this.sessionId = build.sessionId!;
    this.modelId = build.modelId!;
    this.framework = build.framework || "paper";
    this.plan = build.plan as BuildPlan;
    this.phases = (build.phases as PhaseState[]) || [];

    // Restore file memory from DB
    if (build.fileMemory && typeof build.fileMemory === "object") {
      for (const [path, content] of Object.entries(build.fileMemory as Record<string, string>)) {
        this.fileMemory.set(path, content);
      }
    }

    await this.loadExistingFiles();

    try {
      if (!this.plan) throw new Error("No plan to resume from");

      this.emit({ type: "plan-approved" });
      await this.updateBuildState({ status: "building" });
      await this.executePhases();
    } catch (e: any) {
      if (e.message === "Build cancelled" || this.abortController.signal.aborted) {
        this.emit({ type: "build-error", error: "Build was cancelled" });
        await this.updateBuildState({ status: "cancelled" });
      } else {
        this.emit({ type: "build-error", error: this.sanitizeError(e.message || "Build failed") });
        await this.updateBuildState({ status: "error", error: e.message || "Build failed" });
      }
    } finally {
      activeRunners.delete(this.buildId);
    }
  }

  // ─── Pipeline Steps ─────────────────────────────────────────────────

  private async planPhase(userRequest: string): Promise<void> {
    this.emit({ type: "planning" });
    await this.updateBuildState({ status: "planning", thinkingMessage: "Analyzing your request..." });

    const existingFilesForPlanning = this.fileMemory.size > 0
      ? Array.from(this.fileMemory.entries()).map(([path, content]) => ({ path, content }))
      : undefined;
    const planPrompt = buildPlanningPrompt(userRequest, this.framework, existingFilesForPlanning);
    const planRaw = await this.callAI(planPrompt, userRequest);

    const planJson = this.parseAIPlanJSON(planRaw);

    // Handle conversation response
    if (planJson.type === "conversation") {
      await storage.createMessage({
        sessionId: this.sessionId,
        role: "assistant",
        content: planJson.response,
        modelId: this.modelId,
      });
      this.emit({ type: "conversation-response", content: planJson.response });
      await this.updateBuildState({ status: "complete" });
      return;
    }

    // Handle quick-change — agentic loop: AI dynamically decides what to read/update/create/delete
    if (planJson.type === "quick-change") {
      // Start with an empty phase — files are added dynamically
      this.plan = {
        pluginName: "Quick Change",
        packageName: "",
        description: planJson.description || "Applying changes",
        phases: [{ name: "Quick Change", description: planJson.description || "", files: [] }],
      };
      this.phases = [{
        name: "Quick Change",
        description: planJson.description || "",
        status: "active" as const,
        files: [],
      }];

      this.emit({ type: "quick-change-start", description: planJson.description || "Applying changes", files: [] });
      await this.updateBuildState({ status: "building", plan: this.plan, phases: this.phases, thinkingMessage: "Applying changes..." });

      const phaseIndex = 0;
      const fileSummaries: { path: string; summary: string }[] = [];
      const actionsLog: { action: string; path: string; reason: string }[] = [];
      const fileTree = Array.from(this.fileMemory.keys());
      let dynamicFileIndex = 0;
      const MAX_AGENTIC_STEPS = 20;

      for (let step = 0; step < MAX_AGENTIC_STEPS; step++) {
        if (this.abortController.signal.aborted) throw new Error("Build cancelled");

        this.emit({ type: "thinking", message: "Deciding next action..." });
        await this.updateBuildState({ thinkingMessage: "Deciding next action..." });

        const stepPrompt = buildAgenticStepPrompt(userRequest, fileTree, fileSummaries, actionsLog);
        const stepRaw = await this.callAI(stepPrompt, "Decide the next action.");
        let stepJson: any;
        try {
          stepJson = this.parseAIPlanJSON(stepRaw);
        } catch {
          break;
        }

        const action = stepJson.action;
        const actionPath = stepJson.path || "";
        const actionReason = stepJson.reason || "";

        if (action === "done") {
          const changeList = actionsLog
            .filter((a) => a.action !== "read")
            .map((a) => `- \`${a.path}\`: ${a.reason}`)
            .join("\n");
          const summaryContent = `**Quick Change Applied**\n\n${stepJson.summary || planJson.description || "Changes applied"}\n\n${changeList}`;
          await storage.createMessage({
            sessionId: this.sessionId,
            role: "assistant",
            content: summaryContent,
            modelId: this.modelId,
          });
          this.emit({ type: "build-complete", summary: summaryContent });
          await this.updateBuildState({ status: "complete", summary: summaryContent });
          return;
        }

        // Add a dynamic badge
        const fileName = actionPath.split("/").pop() || actionPath;
        const badgeStatus: FileState["status"] =
          action === "read" ? "reading" :
          action === "update" ? "updating" :
          action === "create" ? "generating" :
          action === "delete" ? "deleting" : "pending";
        const fileIdx = dynamicFileIndex++;
        const dynamicFile: FileState = { path: actionPath, name: fileName, description: actionReason, status: badgeStatus };
        this.phases[0].files.push(dynamicFile);
        this.emit({ type: "dynamic-file", phaseIndex, file: dynamicFile });
        await this.updateBuildState({ phases: this.phases });

        if (action === "read") {
          this.emit({ type: "file-reading", phaseIndex, fileIndex: fileIdx });
          this.phases[0].files[fileIdx].status = "reading";
          await this.updateBuildState({ phases: this.phases, thinkingMessage: `Reading ${fileName}...` });

          const content = this.fileMemory.get(actionPath);
          if (content) {
            const readPrompt = buildFileReadPrompt(actionPath, content, userRequest, this.framework);
            const analysisRaw = await this.callAI(readPrompt, `Analyze ${actionPath}`);
            let summaryText: string;
            try {
              const analysis = JSON.parse(analysisRaw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim());
              summaryText = `${analysis.purpose || ""}. Exports: ${(analysis.exports || []).join(", ")}`;
            } catch {
              summaryText = analysisRaw.slice(0, 200);
            }
            fileSummaries.push({ path: actionPath, summary: summaryText });
          }
          this.phases[0].files[fileIdx].status = "read";
          this.emit({ type: "file-read", phaseIndex, fileIndex: fileIdx, path: actionPath });
          await this.updateBuildState({ phases: this.phases, thinkingMessage: null });
        } else if (action === "update") {
          this.emit({ type: "file-updating", phaseIndex, fileIndex: fileIdx });
          this.phases[0].files[fileIdx].status = "updating";
          await this.updateBuildState({ phases: this.phases, thinkingMessage: `Updating ${fileName}...` });

          const existingContent = this.fileMemory.get(actionPath);
          if (existingContent) {
            const patchPrompt = buildPatchPrompt(
              actionPath, existingContent,
              `${userRequest} — specifically: ${actionReason}`,
              this.framework, this.plan.packageName || "com.example.plugin",
            );
            const updatedContent = await this.callAI(patchPrompt, `Apply this change: ${actionReason}`);
            await this.writeFile(actionPath, fileName, updatedContent);
            this.phases[0].files[fileIdx].status = "updated";
            this.emit({ type: "file-updated", phaseIndex, fileIndex: fileIdx, path: actionPath });
          } else {
            this.phases[0].files[fileIdx].status = "error";
            this.emit({ type: "file-error", phaseIndex, fileIndex: fileIdx, error: "File not found for update" });
          }
          await this.updateBuildState({ phases: this.phases, thinkingMessage: null });
        } else if (action === "create") {
          this.emit({ type: "file-generating", phaseIndex, fileIndex: fileIdx });
          this.phases[0].files[fileIdx].status = "generating";
          await this.updateBuildState({ phases: this.phases, thinkingMessage: `Generating ${fileName}...` });

          const genPrompt = buildFileGenerationPrompt(
            actionPath, fileName, actionReason,
            "Quick Change", this.buildProjectContext(), this.framework, this.plan.packageName || "com.example.plugin",
          );
          const content = await this.callAI(genPrompt, `Generate ${actionPath}`);
          await this.writeFile(actionPath, fileName, content);
          fileTree.push(actionPath);
          this.phases[0].files[fileIdx].status = "created";
          this.emit({ type: "file-created", phaseIndex, fileIndex: fileIdx, path: actionPath });
          await this.updateBuildState({ phases: this.phases, thinkingMessage: null });
        } else if (action === "delete") {
          this.emit({ type: "file-deleting", phaseIndex, fileIndex: fileIdx });
          this.phases[0].files[fileIdx].status = "deleting";
          await this.updateBuildState({ phases: this.phases, thinkingMessage: `Deleting ${fileName}...` });

          const existingId = this.fileIdMap.get(actionPath);
          if (existingId) {
            await storage.deleteFile(existingId);
            this.fileMemory.delete(actionPath);
            this.fileIdMap.delete(actionPath);
            const treeIdx = fileTree.indexOf(actionPath);
            if (treeIdx !== -1) fileTree.splice(treeIdx, 1);
          }
          this.phases[0].files[fileIdx].status = "deleted";
          this.emit({ type: "file-deleted", phaseIndex, fileIndex: fileIdx, path: actionPath });
          await this.updateBuildState({ phases: this.phases, thinkingMessage: null });
        }

        actionsLog.push({ action, path: actionPath, reason: actionReason });
      }

      // Hit step limit — wrap up
      const changeList = actionsLog
        .filter((a) => a.action !== "read")
        .map((a) => `- \`${a.path}\`: ${a.reason}`)
        .join("\n");
      const summaryContent = `**Quick Change Applied**\n\n${planJson.description || "Changes applied"}\n\n${changeList}`;
      await storage.createMessage({
        sessionId: this.sessionId,
        role: "assistant",
        content: summaryContent,
        modelId: this.modelId,
      });
      this.emit({ type: "build-complete", summary: summaryContent });
      await this.updateBuildState({ status: "complete", summary: summaryContent });
      return;
    }

    // Validate plan structure
    const plan: BuildPlan = {
      pluginName: planJson.pluginName || "Plugin",
      packageName: planJson.packageName || "com.example.plugin",
      description: planJson.description || "",
      phases: (planJson.phases || []).map((p: any) => ({
        name: p.name || "Phase",
        description: p.description || "",
        files: (p.files || []).map((f: any) => ({
          path: f.path || f.name || "unknown",
          name: f.name || f.path?.split("/").pop() || "unknown",
          description: f.description || "",
        })),
      })),
    };

    if (plan.phases.length === 0 || plan.phases.every((p) => p.files.length === 0)) {
      throw new Error("Build plan contains no files to generate");
    }

    this.plan = plan;
    this.phases = plan.phases.map((p) => ({
      name: p.name,
      description: p.description,
      status: "pending" as const,
      files: p.files.map((f) => ({
        path: f.path,
        name: f.name,
        description: f.description,
        status: "pending" as const,
      })),
    }));

    // Save plan as message
    const planSummary = `**Build Plan: ${plan.pluginName}**\n\n${plan.description}\n\n${plan.phases
      .map(
        (p, i) =>
          `**Phase ${i + 1}: ${p.name}**\n${p.files.map((f) => `- \`${f.path}\` — ${f.description}`).join("\n")}`,
      )
      .join("\n\n")}`;

    await storage.createMessage({
      sessionId: this.sessionId,
      role: "assistant",
      content: planSummary,
      modelId: this.modelId,
    });

    this.emit({ type: "plan-ready", plan });
    await this.updateBuildState({
      status: "awaiting-approval",
      plan,
      phases: this.phases,
      thinkingMessage: null,
    });

    // Wait for user approval
    const result = await new Promise<{ action: string; editInstructions?: string }>((resolve) => {
      this.approvalResolve = resolve;
    });

    if (result.action === "cancel") {
      this.emit({ type: "build-error", error: "Plan was cancelled by user." });
      await this.updateBuildState({ status: "cancelled" });
      return;
    }

    if (result.action === "edit" && result.editInstructions) {
      // Re-plan with modifications
      this.emit({ type: "thinking", message: "Revising plan..." });
      const revisedRaw = await this.callAI(
        buildPlanningPrompt(
          `${userRequest}\n\nIMPORTANT MODIFICATIONS: ${result.editInstructions}`,
          this.framework,
          existingFilesForPlanning,
        ),
        "Revise the build plan with these modifications.",
      );
      const revisedParsed = this.parseAIPlanJSON(revisedRaw);
      if (revisedParsed?.type === "build" || revisedParsed?.phases) {
        this.plan = {
          pluginName: revisedParsed.pluginName || plan.pluginName,
          packageName: revisedParsed.packageName || plan.packageName,
          description: revisedParsed.description || plan.description,
          phases: (revisedParsed.phases || []).map((p: any) => ({
            name: p.name || "Phase",
            description: p.description || "",
            files: (p.files || []).map((f: any) => ({
              path: f.path || f.name || "unknown",
              name: f.name || f.path?.split("/").pop() || "unknown",
              description: f.description || "",
            })),
          })),
        };
        this.phases = this.plan.phases.map((p) => ({
          name: p.name,
          description: p.description,
          status: "pending" as const,
          files: p.files.map((f) => ({
            path: f.path,
            name: f.name,
            description: f.description,
            status: "pending" as const,
          })),
        }));
        this.emit({ type: "plan-ready", plan: this.plan });
        await this.updateBuildState({ plan: this.plan, phases: this.phases });
      }
    }

    // Plan approved — start building
    this.emit({ type: "plan-approved" });
    await this.updateBuildState({ status: "building" });

    await this.executePhases();
  }

  private async executePhases(): Promise<void> {
    if (!this.plan) throw new Error("No plan");
    const signal = this.abortController.signal;

    for (let phaseIdx = 0; phaseIdx < this.plan.phases.length; phaseIdx++) {
      if (signal.aborted) throw new Error("Build cancelled");

      const phaseState = this.phases[phaseIdx];
      if (phaseState?.status === "complete") continue;

      const phase: { name: string; description: string; files: { path: string; name: string; description: string }[] } = this.plan.phases[phaseIdx];
      this.phases[phaseIdx] = { ...this.phases[phaseIdx], status: "active" };
      this.emit({ type: "phase-start", phaseIndex: phaseIdx });
      await this.updateBuildState({ phases: this.phases, currentPhaseIndex: phaseIdx });

      // File reading — ask AI which existing files to read for context
      let dynamicIdx = phase.files.length;
      if (this.fileMemory.size > 0) {
        try {
          this.emit({ type: "thinking", message: "Analyzing dependencies..." });
          await this.updateBuildState({ thinkingMessage: "Analyzing dependencies..." });

          const existingPaths = Array.from(this.fileMemory.keys());
          const phaseFileNames = phase.files.map((f) => `- ${f.path}: ${f.description}`).join("\n");
          const readCheckPrompt = `You are AuroraCraft. For this build phase, determine which existing project files need to be read for context.

Phase: ${phase.name} — ${phase.description}
Files to generate in this phase:
${phaseFileNames}

Existing project files: ${existingPaths.map((p) => `\n- ${p}`).join("")}

Return ONLY a JSON array of file paths that should be read for context. Example: ["pom.xml", "src/main/java/..."]
If no files need to be read, return an empty array: []
No text before or after the JSON.`;

          const readListRaw = await this.callAI(readCheckPrompt, "Which files should I read?");
          let filesToRead: string[] = [];
          try {
            const cleaned = readListRaw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
            filesToRead = JSON.parse(cleaned);
            if (!Array.isArray(filesToRead)) filesToRead = [];
          } catch {
            filesToRead = [];
          }

          for (const readPath of filesToRead) {
            if (signal.aborted) throw new Error("Build cancelled");
            const content = this.fileMemory.get(readPath);
            if (!content) continue;

            const readFileName = readPath.split("/").pop() || readPath;
            const readIdx = dynamicIdx++;
            const dynamicFile: FileState = { path: readPath, name: readFileName, description: "Reading for context", status: "reading" };
            this.phases[phaseIdx].files.push(dynamicFile);
            this.emit({ type: "dynamic-file", phaseIndex: phaseIdx, file: dynamicFile });
            this.emit({ type: "file-reading", phaseIndex: phaseIdx, fileIndex: readIdx });
            await this.updateBuildState({ phases: this.phases, thinkingMessage: `Reading ${readFileName}...` });

            const readPrompt = buildFileReadPrompt(readPath, content, "", this.framework);
            await this.callAI(readPrompt, `Analyze ${readPath}`);

            this.phases[phaseIdx].files[readIdx].status = "read";
            this.emit({ type: "file-read", phaseIndex: phaseIdx, fileIndex: readIdx, path: readPath });
            await this.updateBuildState({ phases: this.phases, thinkingMessage: null });
          }
        } catch (e: any) {
          if (e.message === "Build cancelled") throw e;
          // File reading is non-fatal
        }
      }

      // File creation loop
      let fileIdx = 0;
      while (fileIdx < phase.files.length) {
        if (signal.aborted) throw new Error("Build cancelled");

        const fileState = phaseState?.files[fileIdx];
        if (fileState?.status === "created" || fileState?.status === "updated") {
          this.emit({ type: "file-created", phaseIndex: phaseIdx, fileIndex: fileIdx, path: phase.files[fileIdx].path });
          fileIdx++;
          continue;
        }

        const file = phase.files[fileIdx];
        this.phases[phaseIdx].files[fileIdx] = { ...this.phases[phaseIdx].files[fileIdx], status: "generating" };
        this.emit({ type: "file-generating", phaseIndex: phaseIdx, fileIndex: fileIdx });
        await this.updateBuildState({
          phases: this.phases,
          currentFileIndex: fileIdx,
          thinkingMessage: `Generating ${file.name}...`,
        });

        try {
          const currentPhasePaths = phase.files.slice(0, fileIdx).map((f) => f.path);
          const filePrompt = buildFileGenerationPrompt(
            file.path, file.name, file.description, phase.name,
            this.buildProjectContext(currentPhasePaths), this.framework, this.plan.packageName,
          );

          const fileContent = await this.callAI(filePrompt, `Generate ${file.path}`);
          await this.writeFile(file.path, file.name, fileContent);

          this.phases[phaseIdx].files[fileIdx] = { ...this.phases[phaseIdx].files[fileIdx], status: "created" };
          this.emit({ type: "file-created", phaseIndex: phaseIdx, fileIndex: fileIdx, path: file.path });
          await this.updateBuildState({ phases: this.phases, thinkingMessage: null });
          fileIdx++;
        } catch (e: any) {
          if (e.message === "Build cancelled") throw e;
          const errorMsg = this.sanitizeError(e.message || "Unknown error");
          this.phases[phaseIdx].files[fileIdx] = { ...this.phases[phaseIdx].files[fileIdx], status: "error", error: errorMsg };
          this.emit({ type: "file-error", phaseIndex: phaseIdx, fileIndex: fileIdx, error: errorMsg });
          await this.updateBuildState({ phases: this.phases, thinkingMessage: null });

          // Wait for user decision — track pending error for snapshot restoration
          const errorFilePath = phase.files[fileIdx]?.path || "unknown file";
          this.pendingFileError = { filePath: errorFilePath, error: errorMsg };
          const decision = await new Promise<string>((resolve) => {
            this.fileErrorResolve = resolve;
            setTimeout(() => { this.fileErrorResolve = null; this.pendingFileError = null; resolve("skip"); }, 5 * 60 * 1000);
          });
          this.pendingFileError = null;

          if (decision === "cancel") throw new Error("Build cancelled");
          if (decision === "retry") continue;
          fileIdx++;
        }
      }

      // Phase review — with cross-phase awareness
      if (signal.aborted) throw new Error("Build cancelled");
      this.phases[phaseIdx] = { ...this.phases[phaseIdx], status: "reviewing" };
      this.emit({ type: "phase-reviewing", phaseIndex: phaseIdx });
      await this.updateBuildState({ status: "reviewing", phases: this.phases, thinkingMessage: "Reviewing phase..." });

      try {
        const phaseFiles = phase.files
          .filter((f) => this.fileMemory.has(f.path))
          .map((f) => ({ path: f.path, content: this.fileMemory.get(f.path)! }));

        // Collect ALL project files for cross-phase awareness
        const allProjectFiles = Array.from(this.fileMemory.entries()).map(([path, content]) => ({ path, content }));

        if (phaseFiles.length > 0) {
          const reviewPrompt = buildReviewPrompt(phaseFiles, this.framework, allProjectFiles);
          const reviewRaw = await this.callAI(reviewPrompt, "Review these files.");

          let reviewResult: any;
          try {
            const cleaned = reviewRaw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
            reviewResult = JSON.parse(cleaned);
          } catch {
            const jsonMatch = reviewRaw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try { reviewResult = JSON.parse(jsonMatch[0]); } catch { reviewResult = { passed: true }; }
            } else {
              reviewResult = { passed: true };
            }
          }

          // Cross-phase fix loop
          if (!reviewResult.passed && Array.isArray(reviewResult.fixes)) {
            for (const fix of reviewResult.fixes) {
              if (signal.aborted) throw new Error("Build cancelled");

              // Search across ALL phases for the file
              let fixPhaseIdx = phaseIdx;
              let fixFileIdx = phase.files.findIndex((f) => f.path === fix.path);

              if (fixFileIdx === -1) {
                for (let pi = 0; pi < this.plan!.phases.length; pi++) {
                  const fi = this.plan!.phases[pi].files.findIndex((f) => f.path === fix.path);
                  if (fi !== -1) {
                    fixPhaseIdx = pi;
                    fixFileIdx = fi;
                    break;
                  }
                }
              }

              if (fixFileIdx === -1) continue;
              const fixFile = this.plan!.phases[fixPhaseIdx].files[fixFileIdx];

              this.phases[fixPhaseIdx].files[fixFileIdx] = { ...this.phases[fixPhaseIdx].files[fixFileIdx], status: "updating" };
              this.emit({ type: "file-updating", phaseIndex: fixPhaseIdx, fileIndex: fixFileIdx });
              await this.updateBuildState({ phases: this.phases, thinkingMessage: `Updating ${fixFile.name}...` });

              try {
                const existingContent = this.fileMemory.get(fixFile.path);
                let fixPrompt: string;
                if (existingContent) {
                  fixPrompt = buildPatchPrompt(fixFile.path, existingContent, fix.reason, this.framework, this.plan!.packageName);
                } else {
                  fixPrompt = buildFileGenerationPrompt(
                    fixFile.path, fixFile.name, `${fixFile.description}. FIX REQUIRED: ${fix.reason}`,
                    phase.name, this.buildProjectContext(), this.framework, this.plan!.packageName,
                  );
                }
                const fixedContent = await this.callAI(fixPrompt, `Fix ${fixFile.path}: ${fix.reason}`);
                await this.writeFile(fixFile.path, fixFile.name, fixedContent);
                this.phases[fixPhaseIdx].files[fixFileIdx] = { ...this.phases[fixPhaseIdx].files[fixFileIdx], status: "updated" };
                this.emit({ type: "file-updated", phaseIndex: fixPhaseIdx, fileIndex: fixFileIdx, path: fixFile.path });
                await this.updateBuildState({ phases: this.phases, thinkingMessage: null });
              } catch (e: any) {
                if (e.message === "Build cancelled") throw e;
                this.phases[fixPhaseIdx].files[fixFileIdx] = { ...this.phases[fixPhaseIdx].files[fixFileIdx], status: "error", error: e.message };
                this.emit({ type: "file-error", phaseIndex: fixPhaseIdx, fileIndex: fixFileIdx, error: e.message || "Fix failed" });
                await this.updateBuildState({ phases: this.phases });
              }
            }
          }
        }
      } catch (e: any) {
        if (e.message === "Build cancelled") throw e;
        console.error("Phase review error:", e);
      }

      this.phases[phaseIdx] = { ...this.phases[phaseIdx], status: "complete" };
      this.emit({ type: "phase-complete", phaseIndex: phaseIdx });
      await this.updateBuildState({ status: "building", phases: this.phases, thinkingMessage: null });
    }

    // Summary
    await this.summaryPhase();
  }

  private async summaryPhase(): Promise<void> {
    if (!this.plan) return;
    if (this.abortController.signal.aborted) throw new Error("Build cancelled");

    this.emit({ type: "thinking", message: "Generating build summary..." });
    await this.updateBuildState({ thinkingMessage: "Generating build summary..." });

    const summaryPrompt = buildSummaryPrompt(
      this.plan.pluginName, this.plan.description, this.plan.phases, this.framework,
    );
    const summary = await this.callAI(summaryPrompt, "Generate the build completion summary.");

    await storage.createMessage({
      sessionId: this.sessionId,
      role: "assistant",
      content: summary,
      modelId: this.modelId,
    });

    this.emit({ type: "build-complete", summary });
    await this.updateBuildState({ status: "complete", summary, thinkingMessage: null });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private async callAI(systemPrompt: string, userContent: string): Promise<string> {
    let lastError: Error | null = null;
    const signal = this.abortController.signal;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) throw new Error("Build cancelled");

      try {
        const result = await callAIServer({
          modelId: this.modelId,
          systemPrompt,
          messages: [{ role: "user", content: userContent }],
          maxTokens: 4096,
          signal,
        });

        // Auto-continuation
        let fullText = result.text;
        if (result.finishReason === "length" && fullText.length > 0) {
          for (let cont = 0; cont < MAX_CONTINUATIONS; cont++) {
            if (signal.aborted) break;
            const contPrompt = buildContinuationPrompt("file", fullText.slice(-2000));
            const contResult = await callAIServer({
              modelId: this.modelId,
              systemPrompt: contPrompt,
              messages: [{ role: "user", content: "Continue." }],
              maxTokens: 4096,
              signal,
            });
            fullText += contResult.text;
            if (contResult.finishReason !== "length") break;
          }
        }

        return fullText;
      } catch (e: any) {
        lastError = e;
        if (e.message === "Build cancelled" || signal.aborted) throw e;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        }
      }
    }

    throw lastError || new Error("AI call failed after retries");
  }

  private async writeFile(filePath: string, fileName: string, content: string): Promise<number> {
    const existingId = this.fileIdMap.get(filePath);
    if (existingId) {
      const file = await storage.updateFile(existingId, { content, name: fileName, path: filePath });
      this.fileMemory.set(filePath, content);
      return file!.id;
    }
    const file = await storage.createFile({
      sessionId: this.sessionId,
      name: fileName,
      path: filePath,
      content,
      isFolder: false,
    });
    this.fileMemory.set(filePath, content);
    this.fileIdMap.set(filePath, file.id);
    return file.id;
  }

  private async loadExistingFiles(): Promise<void> {
    try {
      const files = await storage.getFiles(this.sessionId);
      for (const f of files) {
        if (!f.isFolder && f.content) {
          this.fileMemory.set(f.path, f.content);
          this.fileIdMap.set(f.path, f.id);
        }
      }
    } catch {}
  }

  private async updateBuildState(updates: Record<string, any>): Promise<void> {
    // Persist file memory to DB for resume capability
    if (this.fileMemory.size > 0) {
      updates.fileMemory = Object.fromEntries(this.fileMemory);
    }
    try {
      await storage.updateBuild(this.buildId, updates);
    } catch (e) {
      console.error("Failed to update build state:", e);
    }
  }

  private emit(event: BuildEvent): void {
    this.emitter.emit("event", event);
  }

  private buildProjectContext(currentPhasePaths?: string[]): string {
    if (this.fileMemory.size === 0) return "No files created yet.";
    let context = "Files created so far:\n";
    const entries = Array.from(this.fileMemory.entries());
    const prioritySet = new Set(currentPhasePaths || []);
    const sorted = entries.sort(([a], [b]) => {
      const ap = prioritySet.has(a) ? 0 : 1;
      const bp = prioritySet.has(b) ? 0 : 1;
      return ap - bp;
    });
    for (const [path, content] of sorted) {
      context += `\n--- ${path} ---\n${content}\n`;
    }
    return context;
  }

  private sanitizeError(msg: string): string {
    if (!msg) return "An unknown error occurred";
    let clean = msg.replace(/<[^>]*>/g, "");
    if (clean.length > 300) clean = clean.slice(0, 297) + "...";
    return clean;
  }

  private parseAIPlanJSON(text: string): any {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    try {
      return JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {
          try {
            const fixed = match[0].replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"');
            return JSON.parse(fixed);
          } catch {}
        }
      }
      throw new Error("Failed to parse build plan from AI response.");
    }
  }
}
