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
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
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
  getVisibleModels(): Promise<Model[]>;
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

  async getVisibleModels(): Promise<Model[]> {
    return db
      .select()
      .from(models)
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
