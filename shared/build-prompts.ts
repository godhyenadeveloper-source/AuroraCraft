/**
 * Specialized prompt templates for the agentic build pipeline.
 * Each prompt is tightly scoped to one specific operation.
 *
 * Shared between client-side and server-side build engines.
 */

const FRAMEWORK_INFO: Record<string, string> = {
  paper: "Paper API (modern fork with async events, Adventure components for text)",
  bukkit: "Bukkit API (legacy, widely compatible)",
  spigot: "Spigot API (performance-focused Bukkit fork)",
  folia: "Folia (regionized multithreading for Paper)",
  purpur: "Purpur (Paper fork with extra configuration)",
  velocity: "Velocity (modern proxy server)",
  bungeecord: "BungeeCord (legacy proxy server)",
  waterfall: "Waterfall (BungeeCord fork with improvements)",
};

/**
 * Prompt for the PLANNING stage.
 * Asks AI to return a structured JSON build plan — no code, no prose.
 */
export function buildPlanningPrompt(
  userRequest: string,
  framework: string,
  existingFiles?: { path: string; content: string }[],
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;
  let existingContext = "";
  if (existingFiles?.length) {
    existingContext = `\n## EXISTING PROJECT FILES (your memory of the project)\nThe project already has ${existingFiles.length} files. You MUST use this knowledge to make accurate changes — never ask the user for information that is already in these files.\n`;
    for (const f of existingFiles) {
      existingContext += `\n--- ${f.path} ---\n${f.content}\n--- end ---\n`;
    }
  }

  return `You are AuroraCraft, an expert Minecraft plugin architect specializing in Java 21 and ${frameworkDesc}.

Your task is to analyze the user's request and create a structured build plan.

## INSTRUCTIONS
1. Analyze the request and design a complete plugin architecture
2. Break the work into logical phases (scaffolding, core, features, etc.)
3. List every file that needs to be created, with its full path and purpose
4. Return ONLY a valid JSON object — no markdown, no prose, no explanation

## RULES
- Use standard Maven layout: src/main/java/... and src/main/resources/...
- Always include pom.xml and plugin.yml
- Package name should be derived from the plugin name (e.g., com.example.pluginname)
- Each file must have a clear, single responsibility
- Order files within each phase so dependencies come first (e.g., main class before commands)
- Do NOT include file reading steps in the plan. The build engine reads files automatically when needed. Only list files that need to be created or modified.
- For quick-change requests, the engine handles file reading and context gathering automatically.
${existingContext}

## RESPONSE FORMAT
Choose ONE of three response types based on the request complexity:

### 1) QUICK CHANGE — for small, simple modifications to existing files
Use this when the user asks for a simple change like: version bump, rename, config tweak, small bug fix, changing a single value, adding/removing a single command, etc. These are changes that touch 1-3 existing files and don't need user approval.
\`\`\`json
{
  "type": "quick-change",
  "description": "Brief description of what will be changed",
  "files": [
    {
      "path": "pom.xml",
      "name": "pom.xml",
      "description": "Update version from 1.0 to 1.2"
    }
  ]
}
\`\`\`

### 2) BUILD — for new plugins or major feature additions
Use this when the user asks to create/build/make a plugin, add a significant new feature, or make large structural changes that touch many files.
\`\`\`json
{
  "type": "build",
  "pluginName": "PluginName",
  "packageName": "com.example.pluginname",
  "description": "Brief description of the plugin",
  "phases": [
    {
      "name": "Phase Name",
      "description": "What this phase accomplishes",
      "files": [
        {
          "path": "pom.xml",
          "name": "pom.xml",
          "description": "Maven build configuration with Paper API dependency"
        }
      ]
    }
  ]
}
\`\`\`

### 3) CONVERSATION — for questions, greetings, or non-code requests
\`\`\`json
{
  "type": "conversation",
  "response": "Your helpful response here with markdown formatting"
}
\`\`\`

IMPORTANT: Return ONLY the JSON object. No text before or after it. No markdown code fences around it.

User's request: "${userRequest}"`;
}

/**
 * Prompt for generating EXACTLY ONE file.
 * The AI must output only the raw file content — nothing else.
 */
export function buildFileGenerationPrompt(
  filePath: string,
  fileName: string,
  fileDescription: string,
  phaseName: string,
  projectContext: string,
  framework: string,
  packageName: string,
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;

  return `You are AuroraCraft, an expert Java 21 developer specializing in ${frameworkDesc} plugins.

Generate the COMPLETE content of: \`${filePath}\`
Purpose: ${fileDescription} | Phase: ${phaseName} | Package: ${packageName}

${projectContext}

RULES: Output ONLY raw file content. No markdown fences, no commentary, no preamble. File must be COMPLETE with no placeholders or TODOs. All imports must be correct. Use Java 21 features where appropriate.

Generate \`${filePath}\`:`;
}

/**
 * Prompt for applying a TARGETED FIX to an existing file.
 * Sends the current content + fix reason; AI outputs the corrected file.
 */
export function buildPatchPrompt(
  filePath: string,
  currentContent: string,
  fixReason: string,
  framework: string,
  packageName: string,
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;

  return `You are AuroraCraft, a ${frameworkDesc} expert. Apply a targeted fix to \`${filePath}\` (package: ${packageName}).

FIX REQUIRED: ${fixReason}

CURRENT FILE:
${currentContent}

RULES: Output ONLY the complete corrected file content. Change ONLY what is necessary to fix the issue. Preserve all other code exactly. No markdown fences, no commentary.

Output the corrected \`${filePath}\`:`;
}

/**
 * Prompt for reviewing all files in a completed phase.
 * Returns structured JSON indicating pass/fail and needed fixes.
 */
export function buildReviewPrompt(
  phaseFiles: { path: string; content: string }[],
  framework: string,
  allProjectFiles?: { path: string; content: string }[],
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;

  const fileContents = phaseFiles
    .map((f) => `=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`)
    .join("\n\n");

  let crossPhaseContext = "";
  if (allProjectFiles && allProjectFiles.length > phaseFiles.length) {
    const phasePaths = new Set(phaseFiles.map((f) => f.path));
    const otherFiles = allProjectFiles.filter((f) => !phasePaths.has(f.path));
    if (otherFiles.length > 0) {
      crossPhaseContext = `\n\n## OTHER PROJECT FILES (from previous phases — you may fix these too)\n${otherFiles
        .map((f) => `=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`)
        .join("\n\n")}`;
    }
  }

  return `You are AuroraCraft, a Java code reviewer for ${frameworkDesc} plugins.

Review these files for: missing/incorrect imports, wrong package declarations, missing method implementations, inconsistent naming between files, missing plugin.yml entries, incorrect pom.xml dependencies.

${fileContents}${crossPhaseContext}

If a fix requires changing a file from a previous phase, include it in the fixes array with its full path. You may fix any file in the project, not just files from the current phase.

Return ONLY JSON. If correct: { "passed": true }
If fixes needed: { "passed": false, "fixes": [{ "path": "file/path.java", "reason": "description" }] }
No text before or after the JSON.`;
}

/**
 * Prompt for generating the final build summary.
 * This is the ONE place where rich markdown output is desired.
 */
export function buildSummaryPrompt(
  pluginName: string,
  pluginDescription: string,
  phases: { name: string; files: { path: string; name: string }[] }[],
  framework: string,
): string {
  const totalFiles = phases.reduce((sum, p) => sum + p.files.length, 0);
  const fileList = phases
    .flatMap((p) => p.files.map((f) => `- \`${f.path}\``))
    .join("\n");

  return `Build complete: **${pluginName}** (${framework}) — ${pluginDescription}
${totalFiles} files created:
${fileList}

Write a concise markdown build summary. Include: what was built, key features, commands & permissions (if any), how to compile (\`mvn clean package\`), and where to find the JAR. Use headings, bold, code blocks, bullet lists.`;
}

/**
 * Prompt for reading and analyzing an existing file's content.
 * Returns a structured summary for context injection into later AI calls.
 */
export function buildFileReadPrompt(
  filePath: string,
  content: string,
  userRequest: string,
  framework: string,
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;

  return `You are AuroraCraft, a ${frameworkDesc} code analyst. Analyze this file deeply to understand its structure and purpose.

FILE: \`${filePath}\`
CONTENT:
${content}

USER'S CURRENT REQUEST: ${userRequest}

Provide a concise structured analysis as JSON:
{
  "purpose": "one-line description of what this file does",
  "exports": ["list of key classes, methods, variables, or config keys"],
  "dependencies": ["list of imports or dependencies this file relies on"],
  "version": "version number if present, or null",
  "keyPatterns": ["notable patterns: event listeners, command handlers, config keys, etc."],
  "relevantToRequest": "brief note on how this file relates to the user's request"
}

Return ONLY the JSON. No markdown fences, no commentary.`;
}

/**
 * Prompt for the agentic quick-change flow.
 * AI decides the next action: read, update, create, delete, or done.
 */
export function buildAgenticStepPrompt(
  userRequest: string,
  fileTree: string[],
  fileSummaries: { path: string; summary: string }[],
  previousActions: { action: string; path: string; reason: string }[],
): string {
  const summaryContext = fileSummaries.length > 0
    ? `\n## FILE KNOWLEDGE (summaries from previous reads)\n${fileSummaries.map((f) => `- \`${f.path}\`: ${f.summary}`).join("\n")}`
    : "";

  const actionsLog = previousActions.length > 0
    ? `\n## ACTIONS TAKEN SO FAR\n${previousActions.map((a, i) => `${i + 1}. ${a.action} \`${a.path}\` — ${a.reason}`).join("\n")}`
    : "";

  return `You are AuroraCraft, an expert Minecraft plugin developer executing a quick change.

## USER REQUEST
${userRequest}

## PROJECT FILES
${fileTree.map((f) => `- ${f}`).join("\n")}
${summaryContext}${actionsLog}

## YOUR TASK
Decide the NEXT single action to take. You have these options:
- **read**: Read a file to understand its content before making changes
- **update**: Modify an existing file (you must have read it first or have a summary)
- **create**: Create a brand new file
- **delete**: Delete a file that is no longer needed
- **done**: All changes are complete

## RULES
- Read files you need to understand BEFORE updating them
- Only update/create/delete files that are relevant to the request
- When done, provide a brief summary of all changes made
- Be efficient: don't read files unnecessarily

Return ONLY JSON. For actions:
{ "action": "read" | "update" | "create" | "delete", "path": "file/path", "reason": "why this action" }

When finished:
{ "action": "done", "summary": "Brief description of all changes made" }

No text before or after the JSON.`;
}

/**
 * Prompt for auto-continuing a truncated file generation.
 */
export function buildContinuationPrompt(
  filePath: string,
  partialContent: string,
): string {
  return `You were generating the file \`${filePath}\` but your output was cut off.

Here is what you generated so far:
---
${partialContent}
---

Continue generating from EXACTLY where you left off. Output ONLY the remaining content.
Do NOT repeat any content that was already generated above.
The first character of your response must continue directly from the cutoff point.`;
}
