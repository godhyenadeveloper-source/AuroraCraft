import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./auth";
import {
  insertChatSessionSchema,
  insertProviderSchema,
  insertModelSchema,
  insertProjectFileSchema,
} from "@shared/schema";
import { z } from "zod";
import archiver from "archiver";
import OpenAI from "openai";
import { buildSystemPrompt, buildEnhancePrompt, buildErrorFixPrompt } from "./prompts";

function isBuiltInProvider(provider: any): boolean {
  return provider?.authType === "puterjs";
}

function computeTokenUsageFromChars(
  model: any,
  inputChars: number,
  outputChars: number
): number {
  if (!model) return 0;

  const inputRate =
    typeof model.inputCostPerKChar === "number" && model.inputCostPerKChar > 0
      ? model.inputCostPerKChar
      : typeof model.tokenCostPerChar === "number"
      ? model.tokenCostPerChar
      : 0;

  const outputRate =
    typeof model.outputCostPerKChar === "number" && model.outputCostPerKChar > 0
      ? model.outputCostPerKChar
      : typeof model.tokenCostPerChar === "number"
      ? model.tokenCostPerChar
      : 0;

  const safeInputChars = Number.isFinite(inputChars) && inputChars > 0 ? inputChars : 0;
  const safeOutputChars = Number.isFinite(outputChars) && outputChars > 0 ? outputChars : 0;

  const inputTokens =
    inputRate > 0 ? Math.round((safeInputChars / 1000) * inputRate) : 0;
  const outputTokens =
    outputRate > 0 ? Math.round((safeOutputChars / 1000) * outputRate) : 0;

  return inputTokens + outputTokens;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

  // Auth routes
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.json(null);
      }
      const user = req.user as any;
      if (!user?.id) {
        return res.json(null);
      }
      const { passwordHash: _ph, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Models (public for authenticated users)
  app.get("/api/models", isAuthenticated, async (req, res) => {
    try {
      const models = await storage.getVisibleModels();
      res.json(models);
    } catch (error) {
      console.error("Error fetching models:", error);
      res.status(500).json({ message: "Failed to fetch models" });
    }
  });

  // Sessions
  app.get("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const sessions = await storage.getSessions(userId);
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  app.get("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      res.json(session);
    } catch (error) {
      console.error("Error fetching session:", error);
      res.status(500).json({ message: "Failed to fetch session" });
    }
  });

  app.post("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertChatSessionSchema.parse({
        ...req.body,
        userId,
      });
      const session = await storage.createSession(data);
      res.json(session);
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  app.patch("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      const { buildPlan, buildStatus, name, framework, mode } = req.body;
      const updates: Record<string, any> = {};
      if (buildPlan !== undefined) updates.buildPlan = buildPlan;
      if (buildStatus !== undefined) updates.buildStatus = buildStatus;
      if (name !== undefined) updates.name = name;
      if (framework !== undefined) updates.framework = framework;
      if (mode !== undefined) updates.mode = mode;
      const updated = await storage.updateSession(session.id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error updating session:", error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.delete("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      await storage.deleteSession(session.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting session:", error);
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  // Messages
  app.get("/api/sessions/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      const messages = await storage.getMessages(session.id);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/sessions/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { role, content, modelId, tokensUsed } = req.body;

      if (!role || !content || typeof content !== "string") {
        return res.status(400).json({ message: "role and content are required" });
      }

      if (role !== "user" && role !== "assistant" && role !== "system") {
        return res.status(400).json({ message: "Invalid role" });
      }

      const message = await storage.createMessage({
        sessionId: session.id,
        role,
        content,
        modelId: modelId || null,
        tokensUsed: typeof tokensUsed === "number" ? tokensUsed : 0,
      });

      res.json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(500).json({ message: "Failed to create message" });
    }
  });

  app.post("/api/sessions/:id/system-prompt", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { mode } = req.body;

      const files = await storage.getFiles(session.id);
      const compilations = await storage.getCompilations(session.id);
      const previousMessages = await storage.getMessages(session.id);

      const systemPrompt = buildSystemPrompt(mode || session.mode || "agent", {
        session,
        files,
        recentMessages: previousMessages.slice(-10),
        latestCompilation: compilations[0],
      });

      res.json({ systemPrompt });
    } catch (error) {
      console.error("Error building system prompt:", error);
      res.status(500).json({ message: "Failed to build system prompt" });
    }
  });

  // Chat with AI
  app.post("/api/sessions/:id/chat", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { content, mode, modelId } = req.body;
      const userId = req.user.id;

      // Save user message
      await storage.createMessage({
        sessionId: session.id,
        role: "user",
        content,
        modelId: modelId || null,
      });

      let aiResponse = "I understand you want to create a Minecraft plugin. Let me help you with that.";
      let tokensUsed = 0;
      let modelForUsage: any | undefined;

      if (modelId) {
        const model = await storage.getModel(modelId);
        modelForUsage = model;
        if (model && model.providerId) {
          const provider = await storage.getProvider(model.providerId);
          if (provider && provider.apiKey) {
            try {
              // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
              const openai = new OpenAI({
                apiKey: provider.apiKey,
                baseURL: provider.baseUrl,
              });

              const previousMessages = await storage.getMessages(session.id);
              const files = await storage.getFiles(session.id);
              const compilations = await storage.getCompilations(session.id);
              
              const systemPrompt = buildSystemPrompt(mode, {
                session,
                files,
                recentMessages: previousMessages.slice(-10),
                latestCompilation: compilations[0],
              });

              const response = await openai.chat.completions.create({
                model: model.name,
                messages: [
                  { role: "system", content: systemPrompt },
                  ...previousMessages.slice(-20).map((m) => ({
                    role: m.role as "user" | "assistant",
                    content: m.content,
                  })),
                  { role: "user", content },
                ],
                max_completion_tokens: 4096,
              });

              aiResponse = response.choices[0]?.message?.content || aiResponse;
            } catch (aiError) {
              console.error("AI error:", aiError);
              aiResponse = "I encountered an error processing your request. Please try again.";
            }
          }
        }
      }

      if (modelForUsage) {
        const inputChars = typeof content === "string" ? content.length : 0;
        const outputChars = aiResponse ? aiResponse.length : 0;
        tokensUsed = computeTokenUsageFromChars(modelForUsage, inputChars, outputChars);
      }

      // Save assistant message
      const assistantMessage = await storage.createMessage({
        sessionId: session.id,
        role: "assistant",
        content: aiResponse,
        modelId: modelId || null,
        tokensUsed,
      });

      // Deduct tokens from user
      const user = await storage.getUser(userId);
      if (user && tokensUsed > 0) {
        await storage.updateUser(userId, {
          tokenBalance: Math.max(0, (user.tokenBalance || 0) - tokensUsed),
        });

        await storage.createTokenUsage({
          userId,
          sessionId: session.id,
          modelId: modelId || null,
          action: "chat",
          tokensUsed,
        });
      }

      // Update session
      await storage.updateSession(session.id, { mode });

      res.json(assistantMessage);
    } catch (error) {
      console.error("Error in chat:", error);
      res.status(500).json({ message: "Failed to process chat" });
    }
  });

  // Streaming chat with SSE
  app.post("/api/sessions/:id/chat/stream", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { content, mode, modelId } = req.body;
      const userId = req.user.id;

      // Save user message
      await storage.createMessage({
        sessionId: session.id,
        role: "user",
        content,
        modelId: modelId || null,
      });

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let fullResponse = "";
      let tokensUsed = 0;
      let modelForUsage: any | undefined;

      if (modelId) {
        const model = await storage.getModel(modelId);
        modelForUsage = model;
        if (model && model.providerId) {
          const provider = await storage.getProvider(model.providerId);
          if (provider && provider.apiKey) {
            try {
              const openai = new OpenAI({
                apiKey: provider.apiKey,
                baseURL: provider.baseUrl,
              });

              const previousMessages = await storage.getMessages(session.id);
              const files = await storage.getFiles(session.id);
              const compilations = await storage.getCompilations(session.id);
              
              const systemPrompt = buildSystemPrompt(mode, {
                session,
                files,
                recentMessages: previousMessages.slice(-10),
                latestCompilation: compilations[0],
              });

              const stream = await openai.chat.completions.create({
                model: model.name,
                messages: [
                  { role: "system", content: systemPrompt },
                  ...previousMessages.slice(-20).map((m) => ({
                    role: m.role as "user" | "assistant",
                    content: m.content,
                  })),
                  { role: "user", content },
                ],
                max_completion_tokens: 4096,
                stream: true,
              });

              for await (const chunk of stream) {
                const text = chunk.choices[0]?.delta?.content || "";
                if (text) {
                  fullResponse += text;
                  res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
                }
              }
            } catch (aiError) {
              console.error("AI streaming error:", aiError);
              fullResponse = "I encountered an error processing your request. Please try again.";
              res.write(`data: ${JSON.stringify({ type: "error", content: fullResponse })}\n\n`);
            }
          }
        }
      }

      if (!fullResponse) {
        fullResponse = "I understand you want to create a Minecraft plugin. Let me help you with that.";
        res.write(`data: ${JSON.stringify({ type: "chunk", content: fullResponse })}\n\n`);
      }

      if (modelForUsage) {
        const inputChars = typeof content === "string" ? content.length : 0;
        const outputChars = fullResponse ? fullResponse.length : 0;
        tokensUsed = computeTokenUsageFromChars(modelForUsage, inputChars, outputChars);
      }

      // Save assistant message
      const assistantMessage = await storage.createMessage({
        sessionId: session.id,
        role: "assistant",
        content: fullResponse,
        modelId: modelId || null,
        tokensUsed,
      });

      // Deduct tokens from user
      const user = await storage.getUser(userId);
      if (user && tokensUsed > 0) {
        await storage.updateUser(userId, {
          tokenBalance: Math.max(0, (user.tokenBalance || 0) - tokensUsed),
        });

        await storage.createTokenUsage({
          userId,
          sessionId: session.id,
          modelId: modelId || null,
          action: "chat",
          tokensUsed,
        });
      }

      // Update session
      await storage.updateSession(session.id, { mode });

      // Send completion event
      res.write(`data: ${JSON.stringify({ type: "done", messageId: assistantMessage.id, tokensUsed })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error in streaming chat:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to process chat" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", content: "Stream error" })}\n\n`);
        res.end();
      }
    }
  });

  // Enhance prompt
  app.post("/api/enhance-prompt", isAuthenticated, async (req: any, res) => {
    try {
      const { prompt, modelId, framework } = req.body;
      const userId = req.user.id;

      if (!prompt || prompt.trim().length === 0) {
        return res.status(400).json({ message: "Prompt is required" });
      }

      let enhancedPrompt = prompt;
      let tokensUsed = 0;

      if (modelId) {
        const model = await storage.getModel(modelId);
        if (model && model.providerId) {
          const provider = await storage.getProvider(model.providerId);
          if (provider && provider.apiKey) {
            try {
              const openai = new OpenAI({
                apiKey: provider.apiKey,
                baseURL: provider.baseUrl,
              });

              const response = await openai.chat.completions.create({
                model: model.name,
                messages: [
                  {
                    role: "system",
                    content: buildEnhancePrompt(framework),
                  },
                  { role: "user", content: prompt },
                ],
                max_completion_tokens: 500,
              });

              enhancedPrompt = response.choices[0]?.message?.content || prompt;

              const inputChars = typeof prompt === "string" ? prompt.length : 0;
              const outputChars = enhancedPrompt ? enhancedPrompt.length : 0;
              tokensUsed = computeTokenUsageFromChars(model, inputChars, outputChars);
            } catch (aiError) {
              console.error("AI error in enhance:", aiError);
            }
          }
        }
      }

      // Deduct tokens
      if (tokensUsed > 0) {
        const user = await storage.getUser(userId);
        if (user) {
          await storage.updateUser(userId, {
            tokenBalance: Math.max(0, (user.tokenBalance || 0) - tokensUsed),
          });

          await storage.createTokenUsage({
            userId,
            sessionId: null,
            modelId: modelId || null,
            action: "enhance_prompt",
            tokensUsed,
          });
        }
      }

      res.json({ enhancedPrompt, tokensUsed });
    } catch (error) {
      console.error("Error enhancing prompt:", error);
      res.status(500).json({ message: "Failed to enhance prompt" });
    }
  });

  // Files
  app.get("/api/sessions/:id/files", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      const files = await storage.getFiles(session.id);
      res.json(files);
    } catch (error) {
      console.error("Error fetching files:", error);
      res.status(500).json({ message: "Failed to fetch files" });
    }
  });

  app.post("/api/sessions/:id/files", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const data = insertProjectFileSchema.parse({
        ...req.body,
        sessionId: session.id,
      });
      const file = await storage.createFile(data);
      res.json(file);
    } catch (error) {
      console.error("Error creating file:", error);
      res.status(500).json({ message: "Failed to create file" });
    }
  });

  app.patch("/api/files/:id", isAuthenticated, async (req: any, res) => {
    try {
      const file = await storage.getFile(parseInt(req.params.id));
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const session = await storage.getSession(file.sessionId!);
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "File not found" });
      }

      const updated = await storage.updateFile(file.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating file:", error);
      res.status(500).json({ message: "Failed to update file" });
    }
  });

  app.delete("/api/files/:id", isAuthenticated, async (req: any, res) => {
    try {
      const file = await storage.getFile(parseInt(req.params.id));
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const session = await storage.getSession(file.sessionId!);
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "File not found" });
      }

      await storage.deleteFile(file.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  // Download session as ZIP
  app.get("/api/sessions/:id/download", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const files = await storage.getFiles(session.id);
      const archive = archiver("zip", { zlib: { level: 9 } });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${session.name.replace(/[^a-z0-9]/gi, "_")}.zip"`
      );

      archive.pipe(res);

      for (const file of files) {
        if (!file.isFolder && file.content) {
          archive.append(file.content, { name: file.path });
        }
      }

      await archive.finalize();
    } catch (error) {
      console.error("Error downloading session:", error);
      res.status(500).json({ message: "Failed to download session" });
    }
  });

  // Compilations
  app.get("/api/sessions/:id/compilations", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      const compilations = await storage.getCompilations(session.id);
      res.json(compilations);
    } catch (error) {
      console.error("Error fetching compilations:", error);
      res.status(500).json({ message: "Failed to fetch compilations" });
    }
  });

  app.post("/api/sessions/:id/compile", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Create compilation job
      const compilation = await storage.createCompilation({
        sessionId: session.id,
        status: "running",
        startedAt: new Date(),
      });

      // Simulate compilation (in production, this would run Maven)
      setTimeout(async () => {
        try {
          const files = await storage.getFiles(session.id);
          const hasJavaFiles = files.some((f) => f.name.endsWith(".java"));

          if (!hasJavaFiles) {
            await storage.updateCompilation(compilation.id, {
              status: "failed",
              errorMessage: "No Java files found in project",
              logs: "Error: No .java files found. Please create your plugin source files first.",
              completedAt: new Date(),
            });
          } else {
            await storage.updateCompilation(compilation.id, {
              status: "success",
              logs: "Build successful!\n[INFO] Building plugin...\n[INFO] Compiling Java sources...\n[INFO] BUILD SUCCESS",
              artifactPath: `/artifacts/${session.id}/plugin.jar`,
              completedAt: new Date(),
            });
          }
        } catch (e) {
          console.error("Compilation error:", e);
        }
      }, 3000);

      res.json(compilation);
    } catch (error) {
      console.error("Error starting compilation:", error);
      res.status(500).json({ message: "Failed to start compilation" });
    }
  });

  // Admin routes
  app.get("/api/admin/users", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map(({ passwordHash: _ph, ...u }: any) => u));
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const user = await storage.updateUser(req.params.id, req.body);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { passwordHash: _ph, ...safeUser } = user as any;
      res.json(safeUser);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Admin providers
  app.get("/api/admin/providers", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const providers = await storage.getProviders();
      res.json(providers);
    } catch (error) {
      console.error("Error fetching providers:", error);
      res.status(500).json({ message: "Failed to fetch providers" });
    }
  });

  app.post("/api/admin/providers", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const data = insertProviderSchema.parse(req.body);
      if (data.authType === "puterjs" || data.name === "Puter.js") {
        return res.status(400).json({ message: "This provider is built-in" });
      }
      const provider = await storage.createProvider(data);
      res.json(provider);
    } catch (error) {
      console.error("Error creating provider:", error);
      res.status(500).json({ message: "Failed to create provider" });
    }
  });

  app.patch("/api/admin/providers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const providerId = parseInt(req.params.id);
      const existing = await storage.getProvider(providerId);
      if (!existing) {
        return res.status(404).json({ message: "Provider not found" });
      }
      if (isBuiltInProvider(existing)) {
        return res.status(403).json({ message: "This provider cannot be edited" });
      }

      if (req.body?.authType === "puterjs" || req.body?.name === "Puter.js") {
        return res.status(400).json({ message: "This provider identity is reserved" });
      }

      const updated = await storage.updateProvider(providerId, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating provider:", error);
      res.status(500).json({ message: "Failed to update provider" });
    }
  });

  app.delete("/api/admin/providers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const providerId = parseInt(req.params.id);
      const existing = await storage.getProvider(providerId);
      if (!existing) {
        return res.status(404).json({ message: "Provider not found" });
      }
      if (isBuiltInProvider(existing)) {
        return res.status(403).json({ message: "This provider cannot be deleted" });
      }
      await storage.deleteProvider(providerId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting provider:", error);
      res.status(500).json({ message: "Failed to delete provider" });
    }
  });

  // Admin models
  app.get("/api/admin/models", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const models = await storage.getModels();
      res.json(models);
    } catch (error) {
      console.error("Error fetching models:", error);
      res.status(500).json({ message: "Failed to fetch models" });
    }
  });

  app.post("/api/admin/models", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const data = insertModelSchema.parse(req.body);
      const model = await storage.createModel(data);
      res.json(model);
    } catch (error) {
      console.error("Error creating model:", error);
      res.status(500).json({ message: "Failed to create model" });
    }
  });

  app.patch("/api/admin/models/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const model = await storage.updateModel(parseInt(req.params.id), req.body);
      res.json(model);
    } catch (error) {
      console.error("Error updating model:", error);
      res.status(500).json({ message: "Failed to update model" });
    }
  });

  app.delete("/api/admin/models/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteModel(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting model:", error);
      res.status(500).json({ message: "Failed to delete model" });
    }
  });

  // Admin settings
  app.get("/api/admin/settings", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.post("/api/admin/settings", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { key, value } = req.body;
      const setting = await storage.upsertSetting(key, value);
      res.json(setting);
    } catch (error) {
      console.error("Error updating setting:", error);
      res.status(500).json({ message: "Failed to update setting" });
    }
  });

  // Admin stats
  app.get("/api/admin/stats", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Token usage history for current user
  app.get("/api/token-usage", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const usage = await storage.getUserTokenUsage(userId);
      res.json(usage);
    } catch (error) {
      console.error("Error fetching token usage:", error);
      res.status(500).json({ message: "Failed to fetch token usage" });
    }
  });

  // Generic token usage application (used by client-side providers like Puter.js)
  app.post("/api/token-usage/apply", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { sessionId, modelId, inputChars, outputChars, action } = req.body;

      if (!modelId) {
        return res.status(400).json({ message: "modelId is required" });
      }

      const model = await storage.getModel(modelId);
      if (!model) {
        return res.status(404).json({ message: "Model not found" });
      }

      const tokensUsed = computeTokenUsageFromChars(
        model,
        typeof inputChars === "number" ? inputChars : 0,
        typeof outputChars === "number" ? outputChars : 0
      );

      if (!tokensUsed || tokensUsed <= 0) {
        return res.json({ tokensUsed: 0 });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const newBalance = Math.max(0, (user.tokenBalance || 0) - tokensUsed);
      await storage.updateUser(userId, { tokenBalance: newBalance });

      await storage.createTokenUsage({
        userId,
        sessionId: typeof sessionId === "number" ? sessionId : null,
        modelId,
        action: action || "chat",
        tokensUsed,
      });

      res.json({ tokensUsed, tokenBalance: newBalance });
    } catch (error) {
      console.error("Error applying token usage:", error);
      res.status(500).json({ message: "Failed to apply token usage" });
    }
  });

  // ─── Server-Side Build Endpoints ────────────────────────────────────────

  // Start a new server-side build
  app.post("/api/sessions/:id/builds", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { userRequest, modelId } = req.body;
      if (!userRequest || !modelId) {
        return res.status(400).json({ message: "userRequest and modelId are required" });
      }

      // Check for existing active build
      const existing = await storage.getActiveBuild(session.id);
      if (existing) {
        return res.status(409).json({ message: "A build is already active for this session", buildId: existing.id });
      }

      // Save user message
      await storage.createMessage({
        sessionId: session.id,
        role: "user",
        content: userRequest,
        modelId,
      });

      const build = await storage.createBuild({
        sessionId: session.id,
        userId: req.user.id,
        status: "planning",
        userRequest,
        modelId,
        framework: session.framework || "paper",
      });

      // Launch build runner in background (fire-and-forget)
      const { BuildRunner } = await import("./build-runner");
      const runner = new BuildRunner(build.id);
      runner.start(build.id).catch((err) => {
        console.error(`Build ${build.id} failed:`, err);
      });

      res.json({ buildId: build.id });
    } catch (error) {
      console.error("Error starting build:", error);
      res.status(500).json({ message: "Failed to start build" });
    }
  });

  // Get active/latest build state for a session
  app.get("/api/sessions/:id/builds/current", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const build = await storage.getActiveBuild(session.id);
      if (!build) {
        return res.json(null);
      }

      res.json(build);
    } catch (error) {
      console.error("Error fetching build:", error);
      res.status(500).json({ message: "Failed to fetch build" });
    }
  });

  // Approve/edit/cancel a build plan
  app.post("/api/builds/:id/approve", isAuthenticated, async (req: any, res) => {
    try {
      const build = await storage.getBuild(parseInt(req.params.id));
      if (!build || build.userId !== req.user.id) {
        return res.status(404).json({ message: "Build not found" });
      }

      const { action, editInstructions } = req.body;
      const { getRunner } = await import("./build-runner");
      const runner = getRunner(build.id);

      if (runner) {
        runner.resolveApproval({ action, editInstructions });
        res.json({ success: true });
      } else {
        // Runner not in memory — update DB directly
        if (action === "cancel") {
          await storage.updateBuild(build.id, { status: "cancelled" });
        } else if (action === "approve") {
          await storage.updateBuild(build.id, { status: "building" });
        }
        res.json({ success: true, note: "Runner not active, updated DB directly" });
      }
    } catch (error) {
      console.error("Error approving build:", error);
      res.status(500).json({ message: "Failed to approve build" });
    }
  });

  // Cancel a running build
  app.post("/api/builds/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const build = await storage.getBuild(parseInt(req.params.id));
      if (!build || build.userId !== req.user.id) {
        return res.status(404).json({ message: "Build not found" });
      }

      const { getRunner } = await import("./build-runner");
      const runner = getRunner(build.id);
      if (runner) {
        runner.cancel();
      }
      await storage.updateBuild(build.id, { status: "cancelled" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error cancelling build:", error);
      res.status(500).json({ message: "Failed to cancel build" });
    }
  });

  // Resume an interrupted build
  app.post("/api/builds/:id/resume", isAuthenticated, async (req: any, res) => {
    try {
      const build = await storage.getBuild(parseInt(req.params.id));
      if (!build || build.userId !== req.user.id) {
        return res.status(404).json({ message: "Build not found" });
      }

      if (!["error", "cancelled"].includes(build.status || "")) {
        return res.status(400).json({ message: "Build cannot be resumed from current state" });
      }

      await storage.updateBuild(build.id, { status: "building", error: null });

      const { BuildRunner } = await import("./build-runner");
      const runner = new BuildRunner(build.id);
      runner.resume(build.id).catch((err) => {
        console.error(`Build resume ${build.id} failed:`, err);
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error resuming build:", error);
      res.status(500).json({ message: "Failed to resume build" });
    }
  });

  // Handle file error retry/cancel decision
  app.post("/api/builds/:id/file-error-decision", isAuthenticated, async (req: any, res) => {
    try {
      const build = await storage.getBuild(parseInt(req.params.id));
      if (!build || build.userId !== req.user.id) {
        return res.status(404).json({ message: "Build not found" });
      }

      const { decision } = req.body; // 'retry' | 'cancel'
      const { getRunner } = await import("./build-runner");
      const runner = getRunner(build.id);

      if (runner) {
        runner.resolveFileError(decision);
        res.json({ success: true });
      } else {
        res.status(404).json({ message: "Build runner not active" });
      }
    } catch (error) {
      console.error("Error handling file error decision:", error);
      res.status(500).json({ message: "Failed to handle decision" });
    }
  });

  // SSE endpoint for live build progress
  app.get("/api/builds/:id/stream", isAuthenticated, async (req: any, res) => {
    try {
      const build = await storage.getBuild(parseInt(req.params.id));
      if (!build || build.userId !== req.user.id) {
        return res.status(404).json({ message: "Build not found" });
      }

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      // Subscribe to live events if runner is active
      const { getRunner } = await import("./build-runner");
      const runner = getRunner(build.id);

      // Send current state snapshot first — merge runner's live state if available
      const runnerSnapshot = runner?.getSnapshot();
      const snapshot = {
        type: "snapshot" as const,
        state: {
          buildId: build.id,
          status: runnerSnapshot?.status || build.status,
          plan: runnerSnapshot?.plan || build.plan,
          phases: runnerSnapshot?.phases || build.phases,
          thinkingMessage: build.thinkingMessage,
          summary: build.summary,
          error: build.error,
          pendingFileError: runnerSnapshot?.pendingFileError || null,
        },
      };
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

      if (runner) {
        const onEvent = (event: any) => {
          try {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            // Client disconnected
          }
        };

        runner.emitter.on("event", onEvent);

        req.on("close", () => {
          runner.emitter.off("event", onEvent);
        });
      } else {
        // No active runner — just close after snapshot
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
      }
    } catch (error) {
      console.error("Error in build stream:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to stream build" });
      }
    }
  });

  // Lightweight AI generate proxy — streams AI responses via SSE.
  // Does NOT save messages, does NOT deduct tokens. The build engine handles that.
  app.post("/api/ai/generate", isAuthenticated, async (req: any, res) => {
    try {
      const { modelId, systemPrompt, messages, maxTokens } = req.body;

      if (!modelId || !systemPrompt) {
        return res.status(400).json({ message: "modelId and systemPrompt are required" });
      }

      const model = await storage.getModel(modelId);
      if (!model || !model.providerId) {
        return res.status(404).json({ message: "Model not found" });
      }

      const provider = await storage.getProvider(model.providerId);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      if (!provider.apiKey) {
        return res.status(400).json({ message: `API key not configured for ${provider.name}. Please add your API key in the admin panel.` });
      }

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const chatMessages = [
        { role: "system" as const, content: systemPrompt },
        ...(messages || []).map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      const inputChars = chatMessages.reduce((sum, m) => sum + m.content.length, 0);
      let outputChars = 0;
      let finishReason = "";

      try {
        // Handle Google Gemini API
        if (provider.name.toLowerCase() === "google") {
          const modelName = model.name.includes("/") ? model.name.split("/").pop() : model.name;
          const url = `${provider.baseUrl}models/${modelName}:streamGenerateContent?key=${provider.apiKey}&alt=sse`;
          
          const contents = chatMessages.slice(1).map((m: any) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          }));

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents,
              generationConfig: { maxOutputTokens: maxTokens || 4096 }
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          
          while (reader) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split("\n").filter(line => line.startsWith("data: "));
            
            for (const line of lines) {
              try {
                const data = JSON.parse(line.slice(6));
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                if (text) {
                  outputChars += text.length;
                  res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
                }
                if (data.candidates?.[0]?.finishReason) {
                  finishReason = data.candidates[0].finishReason;
                }
              } catch {}
            }
          }

          res.write(`data: ${JSON.stringify({ type: "done", inputChars, outputChars, finishReason })}\n\n`);
          res.end();
        }
        // Handle Bytez-style API (model in URL path, direct API key auth)
        else if (provider.authType === "api_key" || provider.name.toLowerCase() === "bytez") {
          const url = `${provider.baseUrl}${model.name}`;
          
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": provider.apiKey,
            },
            body: JSON.stringify({
              messages: chatMessages,
              max_tokens: maxTokens || 4096,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || data.output || data.response || "";
          outputChars = content.length;
          finishReason = data.choices?.[0]?.finish_reason || "stop";
          
          res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "done", inputChars, outputChars, finishReason })}\n\n`);
          res.end();
        } else {
          // OpenAI-compatible providers
          const openai = new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
          });

          const stream = await openai.chat.completions.create({
            model: model.name,
            messages: chatMessages,
            max_completion_tokens: maxTokens || 4096,
            stream: true,
          });

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
              outputChars += text.length;
              res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
            }
            if (chunk.choices[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
          }

          res.write(`data: ${JSON.stringify({ type: "done", inputChars, outputChars, finishReason })}\n\n`);
          res.end();
        }
      } catch (aiError: any) {
        console.error("AI generate error:", aiError);
        let errorMsg = "AI generation failed";
        let errorDetails = "";
        
        if (aiError?.status === 401 || aiError?.status === 403) {
          errorMsg = `Authentication failed for ${provider.name}. Please check your API key.`;
          errorDetails = "Invalid or expired API key. Get a new key from the provider's website.";
        } else if (aiError?.status === 404) {
          errorMsg = `Model "${model.name}" not found on ${provider.name}.`;
          errorDetails = "The model may have been renamed or removed.";
        } else if (aiError?.status === 429) {
          errorMsg = "Rate limit exceeded. Please try again later.";
          errorDetails = "Too many requests to the API.";
        } else if (aiError?.message) {
          errorMsg = aiError.message;
          if (aiError?.error) errorDetails = JSON.stringify(aiError.error);
        }
        
        console.error("AI error details:", errorDetails || aiError?.status);
        if (!res.headersSent) {
          res.status(500).json({ message: errorMsg, details: errorDetails });
        } else {
          res.write(`data: ${JSON.stringify({ type: "error", content: errorMsg, details: errorDetails })}\n\n`);
          res.end();
        }
      }
    } catch (error) {
      console.error("Error in /api/ai/generate:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to generate AI response" });
      }
    }
  });

  return httpServer;
}
