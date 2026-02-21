/**
 * OpenPaw Memory Manager
 *
 * Architecture:
 *   - Short-term : sliding window of recent messages (in-process)
 *   - Long-term  : MEMORY.md (curated facts) + daily logs in memory/
 *   - Index      : SQLite FTS5 full-text search over all memory files
 *   - Tools      : agent can read / write / search / forget memories
 *
 * Files on disk (all inside MEMORY_DIR, default: ./openpaw-memory/):
 *   MEMORY.md               – curated long-term facts (append + overwrite)
 *   memory/YYYY-MM-DD.md    – append-only daily session logs
 *   memory.db               – SQLite FTS5 index (rebuilt from .md files)
 */

import fs from "fs/promises";
import path from "path";
import Database from "better-sqlite3";
import type { Database as BetterSQLiteDatabase } from "better-sqlite3";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryEntry = {
  id: string;           // uuid
  type: "fact" | "preference" | "decision" | "summary" | "log";
  content: string;
  tags: string[];
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
  source: "user" | "agent" | "system";
};

export type SearchResult = {
  entry: MemoryEntry;
  score: number;        // BM25 rank (higher = more relevant)
  snippet: string;
};

export type ShortTermMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMORY_DIR = process.env.OPENPAW_MEMORY_DIR
  ? path.resolve(process.env.OPENPAW_MEMORY_DIR)
  : path.join(process.cwd(), "openpaw-memory");

const MEMORY_MD   = path.join(MEMORY_DIR, "MEMORY.md");
const DAILY_DIR   = path.join(MEMORY_DIR, "memory");
const DB_PATH     = path.join(MEMORY_DIR, "memory.db");

const MAX_SHORT_TERM = parseInt(process.env.OPENPAW_SHORT_TERM_WINDOW ?? "20");
const MAX_FACTS      = parseInt(process.env.OPENPAW_MAX_FACTS ?? "200");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseMemoryMd(raw: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const blocks = raw.split(/^---$/m).map((b) => b.trim()).filter(Boolean);

  for (const block of blocks) {
    try {
      const meta: Record<string, string> = {};
      const lines = block.split("\n");
      let contentLines: string[] = [];
      let inContent = false;

      for (const line of lines) {
        if (inContent) {
          contentLines.push(line);
        } else if (line.startsWith("<!--") && line.endsWith("-->")) {
          // skip html comments
        } else if (/^[a-z_]+: .+$/i.test(line)) {
          const [k, ...rest] = line.split(": ");
          meta[k.trim()] = rest.join(": ").trim();
        } else {
          inContent = true;
          contentLines.push(line);
        }
      }

      if (!meta.id || !contentLines.join("").trim()) continue;

      entries.push({
        id: meta.id,
        type: (meta.type as MemoryEntry["type"]) ?? "fact",
        content: contentLines.join("\n").trim(),
        tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()) : [],
        createdAt: meta.createdAt ?? new Date().toISOString(),
        updatedAt: meta.updatedAt ?? new Date().toISOString(),
        source: (meta.source as MemoryEntry["source"]) ?? "agent",
      });
    } catch {
      // skip malformed blocks
    }
  }

  return entries;
}

function serializeEntry(e: MemoryEntry): string {
  return [
    `id: ${e.id}`,
    `type: ${e.type}`,
    `tags: ${e.tags.join(", ")}`,
    `createdAt: ${e.createdAt}`,
    `updatedAt: ${e.updatedAt}`,
    `source: ${e.source}`,
    ``,
    e.content,
    ``,
    `---`,
  ].join("\n");
}

// ─── MemoryManager ────────────────────────────────────────────────────────────

export class MemoryManager {
  private db!: BetterSQLiteDatabase;
  private shortTerm: ShortTermMessage[] = [];
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Init ──────────────────────────────────────────────────────────────────

  async init() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    await fs.mkdir(DAILY_DIR, { recursive: true });

    // Ensure MEMORY.md exists
    try {
      await fs.access(MEMORY_MD);
    } catch {
      await fs.writeFile(
        MEMORY_MD,
        `# OpenPaw Long-Term Memory\n\nCreated: ${new Date().toISOString()}\n\n---\n`,
      );
    }

    this.initDb();
    await this.rebuildIndex();

    console.log(`🧠 Memory initialized at ${MEMORY_DIR}`);
  }

  // ── SQLite ────────────────────────────────────────────────────────────────

  private initDb() {
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        type UNINDEXED,
        content,
        tags,
        source UNINDEXED,
        created_at UNINDEXED,
        updated_at UNINDEXED
      );
    `);
  }

  private async rebuildIndex() {
    const entries = await this.readAllEntries();
    this.db.exec("DELETE FROM memory_fts");

    const insert = this.db.prepare(`
      INSERT INTO memory_fts(id, type, content, tags, source, created_at, updated_at)
      VALUES (@id, @type, @content, @tags, @source, @createdAt, @updatedAt)
    `);

    const insertMany = this.db.transaction((rows: MemoryEntry[]) => {
      for (const r of rows) {
        insert.run({
          id: r.id,
          type: r.type,
          content: r.content,
          tags: r.tags.join(" "),
          source: r.source,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        });
      }
    });

    insertMany(entries);
    console.log(`Memory index rebuilt (${entries.length} entries)`);
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async readAllEntries(): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];

    // Long-term MEMORY.md
    try {
      const raw = await fs.readFile(MEMORY_MD, "utf-8");
      results.push(...parseMemoryMd(raw));
    } catch {}

    // Daily logs
    try {
      const files = await fs.readdir(DAILY_DIR);
      for (const file of files.filter((f) => f.endsWith(".md"))) {
        const raw = await fs.readFile(path.join(DAILY_DIR, file), "utf-8");
        results.push(...parseMemoryMd(raw));
      }
    } catch {}

    return results;
  }

  async getEntry(id: string): Promise<MemoryEntry | null> {
    const all = await this.readAllEntries();
    return all.find((e) => e.id === id) ?? null;
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Save a memory entry.
   * - type "log" → goes to today's daily file (append-only)
   * - everything else → goes to MEMORY.md (upsert by id)
   */
  async save(
    content: string,
    options: Partial<Omit<MemoryEntry, "id" | "content" | "createdAt" | "updatedAt">> & { id?: string } = {},
  ): Promise<MemoryEntry> {
    const now = new Date().toISOString();
    const existing = options.id ? await this.getEntry(options.id) : null;

    const entry: MemoryEntry = {
      id: options.id ?? uuid(),
      type: options.type ?? "fact",
      content: content.trim(),
      tags: options.tags ?? [],
      source: options.source ?? "agent",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (entry.type === "log") {
      await this.appendDailyLog(entry);
    } else {
      await this.upsertLongTerm(entry);
    }

    // Update SQLite index
    this.db
      .prepare(
        `DELETE FROM memory_fts WHERE id = ?`,
      )
      .run(entry.id);

    this.db
      .prepare(
        `INSERT INTO memory_fts(id, type, content, tags, source, created_at, updated_at)
         VALUES (@id, @type, @content, @tags, @source, @createdAt, @updatedAt)`,
      )
      .run({
        id: entry.id,
        type: entry.type,
        content: entry.content,
        tags: entry.tags.join(" "),
        source: entry.source,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });

    return entry;
  }

  private async appendDailyLog(entry: MemoryEntry) {
    const file = path.join(DAILY_DIR, `${today()}.md`);
    const block = serializeEntry(entry);
    await fs.appendFile(file, block + "\n");
  }

  private async upsertLongTerm(entry: MemoryEntry) {
    let raw = "";
    try {
      raw = await fs.readFile(MEMORY_MD, "utf-8");
    } catch {}

    const entries = parseMemoryMd(raw);
    const idx = entries.findIndex((e) => e.id === entry.id);

    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }

    // Trim to MAX_FACTS (keep newest)
    const trimmed = entries
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(-MAX_FACTS);

    const header = `# OpenPaw Long-Term Memory\n\nLast updated: ${new Date().toISOString()}\n\n---\n`;
    const body = trimmed.map(serializeEntry).join("\n");
    await fs.writeFile(MEMORY_MD, header + body);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async forget(id: string): Promise<boolean> {
    let raw = "";
    try {
      raw = await fs.readFile(MEMORY_MD, "utf-8");
    } catch {
      return false;
    }

    const entries = parseMemoryMd(raw);
    const filtered = entries.filter((e) => e.id !== id);

    if (filtered.length === entries.length) return false;

    const header = `# OpenPaw Long-Term Memory\n\nLast updated: ${new Date().toISOString()}\n\n---\n`;
    await fs.writeFile(MEMORY_MD, header + filtered.map(serializeEntry).join("\n"));
    this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
    return true;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  search(query: string, limit = 5): SearchResult[] {
    if (!query.trim()) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT id, type, content, tags, source, created_at, updated_at,
                  bm25(memory_fts) AS score,
                  snippet(memory_fts, 2, '[', ']', '...', 20) AS snippet
           FROM memory_fts
           WHERE memory_fts MATCH ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(query, limit) as any[];

      return rows.map((r) => ({
        entry: {
          id: r.id,
          type: r.type,
          content: r.content,
          tags: r.tags ? r.tags.split(" ") : [],
          source: r.source,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
        score: Math.abs(r.score), // bm25 returns negative
        snippet: r.snippet ?? r.content.slice(0, 120),
      }));
    } catch {
      // FTS query syntax error – fall back to LIKE
      const likeRows = this.db
        .prepare(
          `SELECT id, type, content, tags, source, created_at, updated_at
           FROM memory_fts
           WHERE content LIKE ? OR tags LIKE ?
           LIMIT ?`,
        )
        .all(`%${query}%`, `%${query}%`, limit) as any[];

      return likeRows.map((r) => ({
        entry: {
          id: r.id,
          type: r.type,
          content: r.content,
          tags: r.tags ? r.tags.split(" ") : [],
          source: r.source,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
        score: 1,
        snippet: r.content.slice(0, 120),
      }));
    }
  }

  // ── Short-Term ────────────────────────────────────────────────────────────

  addToShortTerm(msg: ShortTermMessage) {
    this.shortTerm.push(msg);
    if (this.shortTerm.length > MAX_SHORT_TERM) {
      this.shortTerm.shift();
    }
  }

  getShortTerm(): ShortTermMessage[] {
    return [...this.shortTerm];
  }

  clearShortTerm() {
    this.shortTerm = [];
  }

  /**
   * Returns a condensed snapshot of recent short-term messages,
   * suitable for injecting into a system prompt.
   */
  getShortTermSummary(): string {
    if (this.shortTerm.length === 0) return "";
    const lines = this.shortTerm
      .slice(-10)
      .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`);
    return `Recent conversation (last ${lines.length} turns):\n${lines.join("\n")}`;
  }

  // ── Auto-flush ────────────────────────────────────────────────────────────

  /**
   * Debounced flush – call this from the agent loop whenever something
   * important happens. Actually writing is handled by save().
   */
  scheduleSave(
    content: string,
    opts: Parameters<typeof this.save>[1] = {},
  ): Promise<MemoryEntry> {
    return this.save(content, opts);
  }

  /**
   * End-of-session flush: compress short-term into a summary log entry.
   */
  async flushSession(agentSummary?: string) {
    const summary =
      agentSummary ??
      (this.shortTerm.length > 0
        ? `Session ended with ${this.shortTerm.length} turns. Last user message: "${this.shortTerm.filter((m) => m.role === "user").pop()?.content?.slice(0, 200) ?? "N/A"}"`
        : "Empty session.");

    await this.save(summary, {
      type: "log",
      tags: ["session-summary", today()],
      source: "system",
    });

    this.clearShortTerm();
    console.log("💾 Session flushed to memory.");
  }

  // ── Context Injection ─────────────────────────────────────────────────────

  /**
   * Build a memory context block to inject into system prompts.
   * Searches for the query term in long-term memory and includes
   * the short-term window.
   */
  async buildContextBlock(query?: string): Promise<string> {
    const parts: string[] = [];

    // Long-term relevant memories
    if (query) {
      const results = this.search(query, 5);
      if (results.length > 0) {
        parts.push("## Relevant Long-Term Memories");
        for (const r of results) {
          parts.push(
            `- [${r.entry.type}] ${r.entry.content.split("\n")[0].slice(0, 150)} _(tags: ${r.entry.tags.join(", ")})_`,
          );
        }
      }
    }

    // Short-term window
    const st = this.getShortTermSummary();
    if (st) {
      parts.push("## Recent Context");
      parts.push(st);
    }

    return parts.length > 0
      ? `\n\n<memory>\n${parts.join("\n\n")}\n</memory>\n`
      : "";
  }

  // ── Stats ──────────────────────────────────────

  async stats() {
    const entries = await this.readAllEntries();
    const byType = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totalEntries: entries.length,
      shortTermLength: this.shortTerm.length,
      byType,
      memoryDir: MEMORY_DIR,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const memory = new MemoryManager();