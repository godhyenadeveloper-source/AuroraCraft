import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  serial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// Users table with auth and admin support
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  isAdmin: boolean("is_admin").default(false),
  tokenBalance: integer("token_balance").default(10000),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Providers (configured by admins)
export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  baseUrl: varchar("base_url").notNull(),
  authType: varchar("auth_type").notNull().default("bearer"), // bearer, api_key, custom
  apiKey: varchar("api_key"),
  customHeaders: jsonb("custom_headers"),
  healthCheckEndpoint: varchar("health_check_endpoint"),
  defaultPayload: jsonb("default_payload"),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Models (associated with providers)
export const models = pgTable("models", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => providers.id),
  name: varchar("name").notNull(),
  displayName: varchar("display_name").notNull(),
  tokenCostPerChar: integer("token_cost_per_char").default(1),
  isEnabled: boolean("is_enabled").default(true),
  isVisible: boolean("is_visible").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Chat Sessions (Projects)
export const chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  name: varchar("name").notNull(),
  projectType: varchar("project_type").default("minecraft"), // minecraft, discord, web
  framework: varchar("framework").default("paper"), // paper, bukkit, spigot, etc.
  mode: varchar("mode").default("agent"), // agent, plan, question
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Chat Messages
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => chatSessions.id),
  role: varchar("role").notNull(), // user, assistant, system
  content: text("content").notNull(),
  modelId: integer("model_id").references(() => models.id),
  tokensUsed: integer("tokens_used").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Project Files
export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => chatSessions.id),
  path: varchar("path").notNull(),
  name: varchar("name").notNull(),
  content: text("content"),
  isFolder: boolean("is_folder").default(false),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Compilation Jobs
export const compilations = pgTable("compilations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => chatSessions.id),
  status: varchar("status").default("pending"), // pending, running, success, failed
  logs: text("logs"),
  artifactPath: varchar("artifact_path"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Token Usage History
export const tokenUsage = pgTable("token_usage", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  sessionId: integer("session_id").references(() => chatSessions.id),
  modelId: integer("model_id").references(() => models.id),
  action: varchar("action").notNull(), // chat, enhance, compile
  tokensUsed: integer("tokens_used").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Site Settings
export const siteSettings = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key").notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  tokenUsage: many(tokenUsage),
}));

export const providersRelations = relations(providers, ({ many }) => ({
  models: many(models),
}));

export const modelsRelations = relations(models, ({ one }) => ({
  provider: one(providers, {
    fields: [models.providerId],
    references: [providers.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [chatSessions.userId],
    references: [users.id],
  }),
  messages: many(chatMessages),
  files: many(projectFiles),
  compilations: many(compilations),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
  model: one(models, {
    fields: [chatMessages.modelId],
    references: [models.id],
  }),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  session: one(chatSessions, {
    fields: [projectFiles.sessionId],
    references: [chatSessions.id],
  }),
}));

export const compilationsRelations = relations(compilations, ({ one }) => ({
  session: one(chatSessions, {
    fields: [compilations.sessionId],
    references: [chatSessions.id],
  }),
}));

export const tokenUsageRelations = relations(tokenUsage, ({ one }) => ({
  user: one(users, {
    fields: [tokenUsage.userId],
    references: [users.id],
  }),
  session: one(chatSessions, {
    fields: [tokenUsage.sessionId],
    references: [chatSessions.id],
  }),
  model: one(models, {
    fields: [tokenUsage.modelId],
    references: [models.id],
  }),
}));

// Insert Schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProviderSchema = createInsertSchema(providers).omit({
  id: true,
  createdAt: true,
});

export const insertModelSchema = createInsertSchema(models).omit({
  id: true,
  createdAt: true,
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompilationSchema = createInsertSchema(compilations).omit({
  id: true,
  createdAt: true,
});

export const insertTokenUsageSchema = createInsertSchema(tokenUsage).omit({
  id: true,
  createdAt: true,
});

export const insertSiteSettingSchema = createInsertSchema(siteSettings).omit({
  id: true,
  updatedAt: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Provider = typeof providers.$inferSelect;
export type InsertProvider = z.infer<typeof insertProviderSchema>;

export type Model = typeof models.$inferSelect;
export type InsertModel = z.infer<typeof insertModelSchema>;

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;

export type Compilation = typeof compilations.$inferSelect;
export type InsertCompilation = z.infer<typeof insertCompilationSchema>;

export type TokenUsage = typeof tokenUsage.$inferSelect;
export type InsertTokenUsage = z.infer<typeof insertTokenUsageSchema>;

export type SiteSetting = typeof siteSettings.$inferSelect;
export type InsertSiteSetting = z.infer<typeof insertSiteSettingSchema>;
