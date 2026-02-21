/**
 * OpenPaw Memory Tools
 *
 * Exposes memory operations as OpenAI-compatible function tools so the agent
 * can read, write, search, and forget memories autonomously.
 */

import { memory } from "./memory-manager";
import type { MemoryEntry } from "./memory-manager";

// ─── Tool Definitions (OpenAI schema) ────────────────────────────────────────

export const memoryTools = [
  {
    name: "memory_save",
    description:
      "Save a fact, preference, decision, or summary to long-term memory. " +
      "Use this whenever the user shares something important you should remember across sessions " +
      "(name, preference, goal, context). For type='log', it goes to today's daily log instead.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The memory content to store. Be concise and factual.",
        },
        type: {
          type: "string",
          enum: ["fact", "preference", "decision", "summary", "log"],
          description:
            "'fact' = objective info, 'preference' = user likes/dislikes, " +
            "'decision' = something decided, 'summary' = session recap, 'log' = ephemeral daily note",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to categorize this memory (e.g. ['user', 'email', 'work'])",
        },
        id: {
          type: "string",
          description: "Optional: provide an existing memory ID to update it instead of creating a new one.",
        },
      },
      required: ["content", "type"],
    },
  },

  {
    name: "memory_search",
    description:
      "Search long-term memory using full-text search. " +
      "Use this at the start of conversations to recall relevant context about the user or topic.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query – keywords, names, topics.",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 5).",
        },
      },
      required: ["query"],
    },
  },

  {
    name: "memory_list",
    description:
      "List all long-term memory entries. Useful for reviewing what is stored. " +
      "Optionally filter by type.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["fact", "preference", "decision", "summary", "log"],
          description: "Filter by memory type (optional).",
        },
        limit: {
          type: "number",
          description: "Max entries to return (default 20).",
        },
      },
      required: [],
    },
  },

  {
    name: "memory_forget",
    description:
      "Delete a specific memory entry by ID. Use when the user asks you to forget something.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The ID of the memory entry to delete.",
        },
      },
      required: ["id"],
    },
  },

  {
    name: "memory_stats",
    description: "Get statistics about the memory store (total entries, breakdown by type, etc.)",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
] as const;

// ─── Tool Executor ────────────────────────────────────────────────────────────

export async function executeMemoryTool(
  toolName: string,
  args: Record<string, any>,
): Promise<string> {
  switch (toolName) {
    // ── memory_save ──────────────────────────────────────────────────────────
    case "memory_save": {
      const entry = await memory.save(args.content, {
        type: args.type ?? "fact",
        tags: args.tags ?? [],
        source: "agent",
        id: args.id,
      });

      return JSON.stringify({
        success: true,
        message: `Memory saved (id: ${entry.id})`,
        entry: {
          id: entry.id,
          type: entry.type,
          tags: entry.tags,
          preview: entry.content.slice(0, 100),
        },
      });
    }

    // ── memory_search ────────────────────────────────────────────────────────
    case "memory_search": {
      const results = memory.search(args.query, args.limit ?? 5);

      if (results.length === 0) {
        return JSON.stringify({ success: true, results: [], message: "No memories found for that query." });
      }

      return JSON.stringify({
        success: true,
        count: results.length,
        results: results.map((r) => ({
          id: r.entry.id,
          type: r.entry.type,
          content: r.entry.content,
          tags: r.entry.tags,
          snippet: r.snippet,
          updatedAt: r.entry.updatedAt,
        })),
      });
    }

    // ── memory_list ──────────────────────────────────────────────────────────
    case "memory_list": {
      const all = await memory.readAllEntries();
      const filtered = args.type
        ? all.filter((e: MemoryEntry) => e.type === args.type)
        : all;
      const limited = filtered.slice(-(args.limit ?? 20));

      return JSON.stringify({
        success: true,
        total: all.length,
        shown: limited.length,
        entries: limited.map((e: MemoryEntry) => ({
          id: e.id,
          type: e.type,
          tags: e.tags,
          preview: e.content.slice(0, 120),
          updatedAt: e.updatedAt,
        })),
      });
    }

    // ── memory_forget ────────────────────────────────────────────────────────
    case "memory_forget": {
      const deleted = await memory.forget(args.id);
      return JSON.stringify({
        success: deleted,
        message: deleted
          ? `Memory ${args.id} deleted.`
          : `Memory ${args.id} not found.`,
      });
    }

    // ── memory_stats ─────────────────────────────────────────────────────────
    case "memory_stats": {
      const stats = await memory.stats();
      return JSON.stringify({ success: true, stats });
    }

    default:
      throw new Error(`Unknown memory tool: ${toolName}`);
  }
}

// ─── OpenAI-compatible tool format ───────────────────────────────────────────

export const memoryOpenAITools = memoryTools.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));