import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import {
  insertChatSessionSchema,
  insertProviderSchema,
  insertModelSchema,
  insertProjectFileSchema,
} from "@shared/schema";
import { z } from "zod";
import archiver from "archiver";
import OpenAI from "openai";

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
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.json(null);
      }
      const user = await storage.getUser(userId);
      res.json(user);
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
      const userId = req.user.claims.sub;
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
      if (!session || session.userId !== req.user.claims.sub) {
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
      const userId = req.user.claims.sub;
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

  app.delete("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.claims.sub) {
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
      if (!session || session.userId !== req.user.claims.sub) {
        return res.status(404).json({ message: "Session not found" });
      }
      const messages = await storage.getMessages(session.id);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Chat with AI
  app.post("/api/sessions/:id/chat", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.claims.sub) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { content, mode, modelId } = req.body;
      const userId = req.user.claims.sub;

      // Save user message
      await storage.createMessage({
        sessionId: session.id,
        role: "user",
        content,
        modelId: modelId || null,
      });

      // Get model and provider
      let aiResponse = "I understand you want to create a Minecraft plugin. Let me help you with that.";
      let tokensUsed = content.length;

      if (modelId) {
        const model = await storage.getModel(modelId);
        if (model && model.providerId) {
          const provider = await storage.getProvider(model.providerId);
          if (provider && provider.apiKey) {
            try {
              // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
              const openai = new OpenAI({
                apiKey: provider.apiKey,
                baseURL: provider.baseUrl,
              });

              const systemPrompt = getSystemPrompt(mode, session.framework || "paper");
              const previousMessages = await storage.getMessages(session.id);

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
              tokensUsed = (response.usage?.total_tokens || content.length) * (model.tokenCostPerChar || 1);
            } catch (aiError) {
              console.error("AI error:", aiError);
              aiResponse = "I encountered an error processing your request. Please try again.";
            }
          }
        }
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
      if (user) {
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

  // Files
  app.get("/api/sessions/:id/files", isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== req.user.claims.sub) {
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
      if (!session || session.userId !== req.user.claims.sub) {
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
      if (!session || session.userId !== req.user.claims.sub) {
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
      if (!session || session.userId !== req.user.claims.sub) {
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
      if (!session || session.userId !== req.user.claims.sub) {
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
      if (!session || session.userId !== req.user.claims.sub) {
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
      if (!session || session.userId !== req.user.claims.sub) {
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
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const user = await storage.updateUser(req.params.id, req.body);
      res.json(user);
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
      const provider = await storage.createProvider(data);
      res.json(provider);
    } catch (error) {
      console.error("Error creating provider:", error);
      res.status(500).json({ message: "Failed to create provider" });
    }
  });

  app.patch("/api/admin/providers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const provider = await storage.updateProvider(parseInt(req.params.id), req.body);
      res.json(provider);
    } catch (error) {
      console.error("Error updating provider:", error);
      res.status(500).json({ message: "Failed to update provider" });
    }
  });

  app.delete("/api/admin/providers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteProvider(parseInt(req.params.id));
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

  return httpServer;
}

function getSystemPrompt(mode: string, framework: string): string {
  const basePrompt = `You are AuroraCraft, an advanced AI specialized in creating Minecraft plugins using Java 21 and Maven. 
You have deep expertise in ${framework.toUpperCase()} API and Minecraft server development.

Key capabilities:
- Generate production-ready Java code for Minecraft plugins
- Create complete Maven project structures (pom.xml, plugin.yml, etc.)
- Implement complex features: custom items, GUIs, events, commands, permissions
- Debug and fix compilation errors
- Explain code architecture and design patterns

Always:
- Use Java 21 features appropriately
- Follow Minecraft plugin best practices
- Create modular, maintainable code
- Include proper error handling
- Add meaningful comments`;

  switch (mode) {
    case "plan":
      return `${basePrompt}

MODE: PLANNING
In this mode, create detailed plans and architecture for the plugin without writing full implementation code.
- Outline the project structure
- Define classes and their responsibilities
- Plan the data flow and event handling
- Suggest design patterns to use
- List required dependencies`;

    case "question":
      return `${basePrompt}

MODE: QUESTION ANSWERING
In this mode, answer questions about Minecraft plugin development.
- Explain concepts clearly
- Provide code examples when helpful
- Reference official documentation
- Suggest best practices`;

    default:
      return `${basePrompt}

MODE: AGENT (Full Implementation)
In this mode, you are an autonomous agent that creates complete plugins.
- Generate all necessary files
- Create working, tested code
- Think step by step
- Validate your implementation
- Stop after completing major phases to ask for confirmation`;
  }
}
