/**
 * 3-Tier Memory Service
 *
 * Scopes:
 *   - "global"   — shared across all users/projects (admin-managed)
 *   - "personal" — per user, shared across their projects
 *   - "project"  — per session/project (highest priority)
 *
 * Priority: project > personal > global
 */

import { db } from "./db";
import {
  memories,
  type Memory,
  type InsertMemory,
} from "@shared/schema";
import { eq, and, or, ilike, desc, sql } from "drizzle-orm";

const PROJECT_LIMIT = 20;
const PERSONAL_LIMIT = 15;
const GLOBAL_LIMIT = 10;

class MemoryService {
  // ─── CRUD ───────────────────────────────────────────────────────────

  async read(
    scope: string,
    query: { ownerId?: string; projectId?: number },
  ): Promise<Memory[]> {
    const conditions = [eq(memories.scope, scope)];

    if (query.ownerId) {
      conditions.push(eq(memories.ownerId, query.ownerId));
    }
    if (query.projectId) {
      conditions.push(eq(memories.projectId, query.projectId));
    }

    return db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.updatedAt));
  }

  async write(data: InsertMemory): Promise<Memory> {
    // Check for duplicates before writing
    const existing = await this.findSimilar(data.scope, data.content, {
      ownerId: data.ownerId ?? undefined,
      projectId: data.projectId ?? undefined,
    });

    if (existing) {
      // Update existing memory instead of creating a duplicate
      const [updated] = await db
        .update(memories)
        .set({ content: data.content, tags: data.tags, updatedAt: new Date() })
        .where(eq(memories.id, existing.id))
        .returning();
      return updated;
    }

    const [memory] = await db.insert(memories).values(data).returning();
    return memory;
  }

  async update(
    id: number,
    content: string,
    tags?: string[],
  ): Promise<Memory | undefined> {
    const updates: Partial<{ content: string; tags: string[]; updatedAt: Date }> = {
      content,
      updatedAt: new Date(),
    };
    if (tags !== undefined) {
      updates.tags = tags;
    }

    const [memory] = await db
      .update(memories)
      .set(updates)
      .where(eq(memories.id, id))
      .returning();
    return memory;
  }

  async delete(id: number): Promise<void> {
    await db.delete(memories).where(eq(memories.id, id));
  }

  async getById(id: number): Promise<Memory | undefined> {
    const [memory] = await db
      .select()
      .from(memories)
      .where(eq(memories.id, id));
    return memory;
  }

  // ─── Search ─────────────────────────────────────────────────────────

  async search(
    scope: string,
    keyword: string,
    opts: { ownerId?: string; projectId?: number },
  ): Promise<Memory[]> {
    const conditions = [
      eq(memories.scope, scope),
      ilike(memories.content, `%${keyword}%`),
    ];

    if (opts.ownerId) {
      conditions.push(eq(memories.ownerId, opts.ownerId));
    }
    if (opts.projectId) {
      conditions.push(eq(memories.projectId, opts.projectId));
    }

    return db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.updatedAt))
      .limit(20);
  }

  // ─── 3-Tier Context Merge ──────────────────────────────────────────

  async getContextForAI(
    userId: string,
    sessionId: number,
  ): Promise<string> {
    const [projectMems, personalMems, globalMems] = await Promise.all([
      db
        .select()
        .from(memories)
        .where(
          and(eq(memories.scope, "project"), eq(memories.projectId, sessionId)),
        )
        .orderBy(desc(memories.updatedAt))
        .limit(PROJECT_LIMIT),

      db
        .select()
        .from(memories)
        .where(
          and(eq(memories.scope, "personal"), eq(memories.ownerId, userId)),
        )
        .orderBy(desc(memories.updatedAt))
        .limit(PERSONAL_LIMIT),

      db
        .select()
        .from(memories)
        .where(eq(memories.scope, "global"))
        .orderBy(desc(memories.updatedAt))
        .limit(GLOBAL_LIMIT),
    ]);

    if (
      projectMems.length === 0 &&
      personalMems.length === 0 &&
      globalMems.length === 0
    ) {
      return "";
    }

    const sections: string[] = [];

    if (projectMems.length > 0) {
      sections.push(
        "### Project Memory (highest priority)\n" +
          projectMems
            .map((m) => `- ${m.content}${m.tags?.length ? ` [${(m.tags as string[]).join(", ")}]` : ""}`)
            .join("\n"),
      );
    }

    if (personalMems.length > 0) {
      sections.push(
        "### Personal Memory\n" +
          personalMems
            .map((m) => `- ${m.content}${m.tags?.length ? ` [${(m.tags as string[]).join(", ")}]` : ""}`)
            .join("\n"),
      );
    }

    if (globalMems.length > 0) {
      sections.push(
        "### Global Knowledge\n" +
          globalMems
            .map((m) => `- ${m.content}`)
            .join("\n"),
      );
    }

    return "## Memory Context\n" + sections.join("\n\n");
  }

  // ─── Duplicate Prevention ──────────────────────────────────────────

  async findSimilar(
    scope: string,
    content: string,
    opts: { ownerId?: string; projectId?: number },
  ): Promise<Memory | null> {
    // Extract significant keywords (4+ chars) from the new content
    const keywords = content
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4);

    if (keywords.length === 0) return null;

    // Fetch candidates in this scope
    const conditions = [eq(memories.scope, scope)];
    if (opts.ownerId) {
      conditions.push(eq(memories.ownerId, opts.ownerId));
    }
    if (opts.projectId) {
      conditions.push(eq(memories.projectId, opts.projectId));
    }

    const candidates = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.updatedAt))
      .limit(50);

    for (const candidate of candidates) {
      const candidateWords = new Set(
        candidate.content
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length >= 4),
      );

      const overlap = keywords.filter((kw) => candidateWords.has(kw)).length;
      const ratio = overlap / keywords.length;

      if (ratio >= 0.7) {
        return candidate;
      }
    }

    return null;
  }

  // ─── File Structure Map ──────────────────────────────────────────

  async updateFileStructureMap(
    projectId: number,
    ownerId: string | null,
    fileEntries: { path: string; description: string }[],
  ): Promise<void> {
    const mapContent = "## File Structure Map\n" +
      fileEntries.map(f => `- \`${f.path}\` — ${f.description}`).join("\n");

    // Tag-based upsert: find existing file-structure-map entry
    const existing = await db.select().from(memories).where(
      and(
        eq(memories.scope, "project"),
        eq(memories.projectId, projectId),
        sql`${memories.tags}::jsonb @> '["file-structure-map"]'::jsonb`,
      ),
    ).limit(1);

    if (existing.length > 0) {
      await db.update(memories)
        .set({ content: mapContent, updatedAt: new Date() })
        .where(eq(memories.id, existing[0].id));
    } else {
      await db.insert(memories).values({
        scope: "project",
        ownerId,
        projectId,
        content: mapContent,
        tags: ["file-structure-map"],
        isInternal: true,
      });
    }
  }

  // ─── Bulk Delete (for cascade) ─────────────────────────────────────

  async deleteByProject(projectId: number): Promise<void> {
    await db
      .delete(memories)
      .where(eq(memories.projectId, projectId));
  }

  async deleteByOwner(ownerId: string): Promise<void> {
    await db
      .delete(memories)
      .where(eq(memories.ownerId, ownerId));
  }
}

export const memoryService = new MemoryService();
