import {
  users,
  providers,
  models,
  chatSessions,
  chatMessages,
  projectFiles,
  compilations,
  tokenUsage,
  siteSettings,
  type User,
  type UpsertUser,
  type Provider,
  type InsertProvider,
  type Model,
  type InsertModel,
  type ChatSession,
  type InsertChatSession,
  type ChatMessage,
  type InsertChatMessage,
  type ProjectFile,
  type InsertProjectFile,
  type Compilation,
  type InsertCompilation,
  type TokenUsage,
  type InsertTokenUsage,
  type SiteSetting,
  type InsertSiteSetting,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, ne, or, sql } from "drizzle-orm";
import { randomBytes, scrypt as scryptCallback } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  // Provider operations
  getProviders(): Promise<Provider[]>;
  getProvider(id: number): Promise<Provider | undefined>;
  createProvider(data: InsertProvider): Promise<Provider>;
  updateProvider(id: number, data: Partial<InsertProvider>): Promise<Provider | undefined>;
  deleteProvider(id: number): Promise<void>;

  // Model operations
  getModels(): Promise<Model[]>;
  getVisibleModels(): Promise<(Model & { providerAuthType: string | null })[]>;
  getModel(id: number): Promise<Model | undefined>;
  createModel(data: InsertModel): Promise<Model>;
  updateModel(id: number, data: Partial<InsertModel>): Promise<Model | undefined>;
  deleteModel(id: number): Promise<void>;

  // Session operations
  getSessions(userId: string): Promise<ChatSession[]>;
  getSession(id: number): Promise<ChatSession | undefined>;
  createSession(data: InsertChatSession): Promise<ChatSession>;
  updateSession(id: number, data: Partial<InsertChatSession>): Promise<ChatSession | undefined>;
  deleteSession(id: number): Promise<void>;

  // Message operations
  getMessages(sessionId: number): Promise<ChatMessage[]>;
  createMessage(data: InsertChatMessage): Promise<ChatMessage>;

  // File operations
  getFiles(sessionId: number): Promise<ProjectFile[]>;
  getFile(id: number): Promise<ProjectFile | undefined>;
  createFile(data: InsertProjectFile): Promise<ProjectFile>;
  updateFile(id: number, data: Partial<InsertProjectFile>): Promise<ProjectFile | undefined>;
  deleteFile(id: number): Promise<void>;

  // Compilation operations
  getCompilations(sessionId: number): Promise<Compilation[]>;
  getCompilation(id: number): Promise<Compilation | undefined>;
  createCompilation(data: InsertCompilation): Promise<Compilation>;
  updateCompilation(id: number, data: Partial<InsertCompilation>): Promise<Compilation | undefined>;

  // Token usage operations
  createTokenUsage(data: InsertTokenUsage): Promise<TokenUsage>;
  getUserTokenUsage(userId: string): Promise<TokenUsage[]>;

  // Site settings operations
  getSettings(): Promise<SiteSetting[]>;
  getSetting(key: string): Promise<SiteSetting | undefined>;
  upsertSetting(key: string, value: string): Promise<SiteSetting>;

  // Stats
  getStats(): Promise<{
    totalUsers: number;
    totalSessions: number;
    totalTokensUsed: number;
    totalCompilations: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Provider operations
  async getProviders(): Promise<Provider[]> {
    return db.select().from(providers).orderBy(desc(providers.createdAt));
  }

  async getProvider(id: number): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    return provider;
  }

  async createProvider(data: InsertProvider): Promise<Provider> {
    const [provider] = await db.insert(providers).values(data).returning();
    return provider;
  }

  async updateProvider(id: number, data: Partial<InsertProvider>): Promise<Provider | undefined> {
    const [provider] = await db
      .update(providers)
      .set(data)
      .where(eq(providers.id, id))
      .returning();
    return provider;
  }

  async deleteProvider(id: number): Promise<void> {
    await db.delete(providers).where(eq(providers.id, id));
  }

  // Model operations
  async getModels(): Promise<Model[]> {
    return db.select().from(models).orderBy(desc(models.createdAt));
  }

  async getVisibleModels(): Promise<(Model & { providerAuthType: string | null })[]> {
    return db
      .select({
        id: models.id,
        providerId: models.providerId,
        name: models.name,
        displayName: models.displayName,
        description: models.description,
        tokenCostPerChar: models.tokenCostPerChar,
        inputCostPerKChar: models.inputCostPerKChar,
        outputCostPerKChar: models.outputCostPerKChar,
        isEnabled: models.isEnabled,
        isVisible: models.isVisible,
        createdAt: models.createdAt,
        providerAuthType: providers.authType,
      })
      .from(models)
      .leftJoin(providers, eq(models.providerId, providers.id))
      .where(and(eq(models.isEnabled, true), eq(models.isVisible, true)));
  }

  async getModel(id: number): Promise<Model | undefined> {
    const [model] = await db.select().from(models).where(eq(models.id, id));
    return model;
  }

  async createModel(data: InsertModel): Promise<Model> {
    const [model] = await db.insert(models).values(data).returning();
    return model;
  }

  async updateModel(id: number, data: Partial<InsertModel>): Promise<Model | undefined> {
    const [model] = await db.update(models).set(data).where(eq(models.id, id)).returning();
    return model;
  }

  async deleteModel(id: number): Promise<void> {
    await db.delete(models).where(eq(models.id, id));
  }

  // Session operations
  async getSessions(userId: string): Promise<ChatSession[]> {
    return db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt));
  }

  async getSession(id: number): Promise<ChatSession | undefined> {
    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, id));
    return session;
  }

  async createSession(data: InsertChatSession): Promise<ChatSession> {
    const [session] = await db.insert(chatSessions).values(data).returning();
    return session;
  }

  async updateSession(id: number, data: Partial<InsertChatSession>): Promise<ChatSession | undefined> {
    const [session] = await db
      .update(chatSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(chatSessions.id, id))
      .returning();
    return session;
  }

  async deleteSession(id: number): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, id));
    await db.delete(projectFiles).where(eq(projectFiles.sessionId, id));
    await db.delete(compilations).where(eq(compilations.sessionId, id));
    await db.delete(chatSessions).where(eq(chatSessions.id, id));
  }

  // Message operations
  async getMessages(sessionId: number): Promise<ChatMessage[]> {
    return db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
  }

  async createMessage(data: InsertChatMessage): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values(data).returning();
    return message;
  }

  // File operations
  async getFiles(sessionId: number): Promise<ProjectFile[]> {
    return db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.sessionId, sessionId))
      .orderBy(projectFiles.path);
  }

  async getFile(id: number): Promise<ProjectFile | undefined> {
    const [file] = await db.select().from(projectFiles).where(eq(projectFiles.id, id));
    return file;
  }

  async createFile(data: InsertProjectFile): Promise<ProjectFile> {
    const [file] = await db.insert(projectFiles).values(data).returning();
    return file;
  }

  async updateFile(id: number, data: Partial<InsertProjectFile>): Promise<ProjectFile | undefined> {
    const [file] = await db
      .update(projectFiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projectFiles.id, id))
      .returning();
    return file;
  }

  async deleteFile(id: number): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.id, id));
  }

  // Compilation operations
  async getCompilations(sessionId: number): Promise<Compilation[]> {
    return db
      .select()
      .from(compilations)
      .where(eq(compilations.sessionId, sessionId))
      .orderBy(desc(compilations.createdAt));
  }

  async getCompilation(id: number): Promise<Compilation | undefined> {
    const [compilation] = await db.select().from(compilations).where(eq(compilations.id, id));
    return compilation;
  }

  async createCompilation(data: InsertCompilation): Promise<Compilation> {
    const [compilation] = await db.insert(compilations).values(data).returning();
    return compilation;
  }

  async updateCompilation(id: number, data: Partial<InsertCompilation>): Promise<Compilation | undefined> {
    const [compilation] = await db
      .update(compilations)
      .set(data)
      .where(eq(compilations.id, id))
      .returning();
    return compilation;
  }

  // Token usage operations
  async createTokenUsage(data: InsertTokenUsage): Promise<TokenUsage> {
    const [usage] = await db.insert(tokenUsage).values(data).returning();
    return usage;
  }

  async getUserTokenUsage(userId: string): Promise<TokenUsage[]> {
    return db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.userId, userId))
      .orderBy(desc(tokenUsage.createdAt));
  }

  // Site settings operations
  async getSettings(): Promise<SiteSetting[]> {
    return db.select().from(siteSettings);
  }

  async getSetting(key: string): Promise<SiteSetting | undefined> {
    const [setting] = await db.select().from(siteSettings).where(eq(siteSettings.key, key));
    return setting;
  }

  async upsertSetting(key: string, value: string): Promise<SiteSetting> {
    const [setting] = await db
      .insert(siteSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: siteSettings.key,
        set: { value, updatedAt: new Date() },
      })
      .returning();
    return setting;
  }

  // Stats
  async getStats(): Promise<{
    totalUsers: number;
    totalSessions: number;
    totalTokensUsed: number;
    totalCompilations: number;
  }> {
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    const [sessionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chatSessions);
    const [tokenSum] = await db
      .select({ sum: sql<number>`coalesce(sum(tokens_used), 0)::int` })
      .from(tokenUsage);
    const [compilationCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(compilations);

    return {
      totalUsers: userCount?.count || 0,
      totalSessions: sessionCount?.count || 0,
      totalTokensUsed: tokenSum?.sum || 0,
      totalCompilations: compilationCount?.count || 0,
    };
  }
}

export const storage = new DatabaseStorage();

export async function seedDefaultAdmin(): Promise<void> {
  try {
    const adminId = (process.env.ADMIN_ID || "admin-default").trim();
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@auroracraft.local")
      .trim()
      .toLowerCase();
    const adminUsername = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
    const adminPassword =
      process.env.ADMIN_PASSWORD ||
      process.env.DEFAULT_ADMIN_PASSWORD ||
      (process.env.NODE_ENV === "production" ? "" : "adminadmin");

    if (adminEmail && !adminEmail.includes("@")) {
      throw new Error("ADMIN_EMAIL must be a valid email address");
    }
    if (!adminUsername || adminUsername.length < 3) {
      throw new Error("ADMIN_USERNAME must be at least 3 characters");
    }
    if (adminPassword && adminPassword.length < 8) {
      throw new Error("ADMIN_PASSWORD must be at least 8 characters");
    }

    const [conflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          or(eq(users.email, adminEmail), eq(users.username, adminUsername)),
          ne(users.id, adminId)
        )
      )
      .limit(1);
    if (conflict) {
      throw new Error("ADMIN_EMAIL/ADMIN_USERNAME already belongs to another account");
    }

    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.id, adminId))
      .limit(1);

    if (!existingAdmin && process.env.NODE_ENV === "production" && !adminPassword) {
      throw new Error(
        "Missing ADMIN_PASSWORD (or DEFAULT_ADMIN_PASSWORD) for initial admin creation in production"
      );
    }

    const passwordHash = adminPassword ? await hashPassword(adminPassword) : null;

    if (!existingAdmin) {
      await db.insert(users).values({
        id: adminId,
        email: adminEmail,
        username: adminUsername,
        passwordHash,
        firstName: "Admin",
        lastName: "User",
        isAdmin: true,
        tokenBalance: 100000,
      });
      console.log(`[seed] Ensured admin user (${adminEmail})`);
      return;
    }

    const updates: any = {
      isAdmin: true,
    };
    if (adminEmail && existingAdmin.email !== adminEmail) updates.email = adminEmail;
    if (adminUsername && existingAdmin.username !== adminUsername) updates.username = adminUsername;

    if (process.env.ADMIN_PASSWORD) {
      updates.passwordHash = passwordHash;
    } else if (!existingAdmin.passwordHash && passwordHash) {
      updates.passwordHash = passwordHash;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, existingAdmin.id));
    }
    console.log(`[seed] Ensured admin user (${adminEmail})`);
  } catch (error) {
    console.error("[seed] Failed to create default admin:", error);
  }
}

export async function seedBuiltInProviders(): Promise<void> {
  try {
    const name = "Puter.js";
    const authType = "puterjs";
    const baseUrl = "https://js.puter.com/v2/";

    const [existing] = await db
      .select()
      .from(providers)
      .where(or(eq(providers.authType, authType), eq(providers.name, name)))
      .limit(1);

    if (!existing) {
      await db.insert(providers).values({
        name,
        baseUrl,
        authType,
        apiKey: null,
        customHeaders: null,
        healthCheckEndpoint: null,
        defaultPayload: null,
        isEnabled: true,
      });
      console.log(`[seed] Ensured provider (${name})`);
      return;
    }

    const updates: any = {};
    if (existing.name !== name) updates.name = name;
    if (existing.baseUrl !== baseUrl) updates.baseUrl = baseUrl;
    if (existing.authType !== authType) updates.authType = authType;
    if (existing.apiKey) updates.apiKey = null;
    if (existing.customHeaders) updates.customHeaders = null;
    if (existing.healthCheckEndpoint) updates.healthCheckEndpoint = null;
    if (existing.defaultPayload) updates.defaultPayload = null;
    if (!existing.isEnabled) updates.isEnabled = true;

    if (Object.keys(updates).length > 0) {
      await db.update(providers).set(updates).where(eq(providers.id, existing.id));
    }

    console.log(`[seed] Ensured provider (${name})`);
  } catch (error) {
    console.error("[seed] Failed to seed providers:", error);
  }
}

export async function seedBuiltInModels(): Promise<void> {
  try {
    const [puter] = await db
      .select()
      .from(providers)
      .where(eq(providers.authType, "puterjs"))
      .limit(1);

    if (!puter) {
      console.warn("[seed] Puter.js provider not found, skipping built-in models");
      return;
    }

    const builtInModels = [
      {
        name: "claude-sonnet-4-5",
        displayName: "Claude Sonnet 4.5",
        description: "Claude Sonnet 4.5 via Puter.js",
        inputCostPerKChar: 10,
        outputCostPerKChar: 20,
      },
      {
        name: "claude-opus-4-5",
        displayName: "Claude Opus 4.5",
        description: "Claude Opus 4.5 via Puter.js",
        inputCostPerKChar: 20,
        outputCostPerKChar: 40,
      },
    ];

    for (const m of builtInModels) {
      const [existing] = await db
        .select()
        .from(models)
        .where(and(eq(models.providerId, puter.id), eq(models.name, m.name)))
        .limit(1);

      if (!existing) {
        await db.insert(models).values({
          providerId: puter.id,
          name: m.name,
          displayName: m.displayName,
          description: m.description,
          inputCostPerKChar: m.inputCostPerKChar,
          outputCostPerKChar: m.outputCostPerKChar,
          isEnabled: true,
          isVisible: true,
        });
        console.log(`[seed] Ensured model (${m.displayName}) for provider (${puter.name})`);
      }
    }
  } catch (error) {
    console.error("[seed] Failed to seed built-in models:", error);
  }
}
