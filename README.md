//memory storage readme

# OpenPaw Memory System

Persistent memory for your AI agent. Inspired by OpenClaw.

## Architecture

```
openpaw-memory/
├── MEMORY.md          ← Long-term facts, preferences, decisions (curated)
├── memory/
│   ├── 2024-01-15.md  ← Append-only daily session logs
│   └── 2024-01-16.md
└── memory.db          ← SQLite FTS5 index (auto-rebuilt from .md files)
```

| Layer          | Storage                        | Lifetime             | Use for                            |
| -------------- | ------------------------------ | -------------------- | ---------------------------------- |
| **Short-term** | In-process array (max 20 msgs) | Session only         | Recent context window              |
| **Long-term**  | `MEMORY.md` (upsert by ID)     | Forever              | Facts, preferences, decisions      |
| **Daily logs** | `memory/YYYY-MM-DD.md`         | Forever, append-only | Session summaries, ephemeral notes |
| **Index**      | SQLite FTS5 + BM25             | Rebuilt on start     | Fast full-text search              |

## Installation

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

## Setup

### 1. Copy files into your project

```
src/
  memory/
    memory-manager.ts   ← Core engine
    memory-tools.ts     ← OpenAI tool definitions
```

### 2. Update your `index.ts`

See `index-with-memory.ts` for the full diff. Key changes:

```typescript
import { memory } from "./memory/memory-manager";
import {
  memoryOpenAITools,
  executeMemoryTool,
  memoryTools,
} from "./memory/memory-tools";

// Init before starting
await memory.init();

// Inject context into system prompt
const memoryContext = await memory.buildContextBlock(userInput);

// Register tools
const openAITools = [...existingTools, ...memoryOpenAITools];

// Route tool calls
if (memoryTools.some((t) => t.name === toolName)) {
  return await executeMemoryTool(toolName, args);
}

// Flush on exit
await memory.flushSession();
```

### 3. Optional env vars

```env
OPENPAW_MEMORY_DIR=./openpaw-memory   # where to store memory files
OPENPAW_SHORT_TERM_WINDOW=20           # max messages in short-term window
OPENPAW_MAX_FACTS=200                  # max entries in MEMORY.md before trimming
```

## Agent Behavior

The system prompt tells the agent to:

1. **Search memory** at the start of each conversation for relevant context
2. **Save facts** whenever the user shares name, preferences, goals, or important context
3. **Update** existing memories using their ID (avoiding duplicates)
4. **Forget** when the user asks

### Memory Types

| Type         | Description                     | Example                              |
| ------------ | ------------------------------- | ------------------------------------ |
| `fact`       | Objective info about user/world | "User's name is Alex"                |
| `preference` | Likes/dislikes                  | "User prefers bullet points"         |
| `decision`   | Something decided together      | "We decided to use Notion for tasks" |
| `summary`    | Session recap                   | "Discussed Q4 planning..."           |
| `log`        | Daily append-only note          | Goes to `memory/YYYY-MM-DD.md`       |

## Dev Commands

In CLI mode, type `/memory` to see live stats:

```
> /memory
🧠 Memory stats: {
  "totalEntries": 12,
  "shortTermLength": 4,
  "byType": { "fact": 5, "preference": 3, "log": 4 },
  "memoryDir": "/your/project/openpaw-memory"
}
```

## How It Works

1. **On startup** – SQLite index is rebuilt from all `.md` files
2. **On each message** – `buildContextBlock(query)` does a BM25 search and injects the top 5 matching memories into the system prompt
3. **During conversation** – agent calls `memory_save` when it learns something important
4. **On exit** – `flushSession()` writes a summary log entry for the session
5. **MEMORY.md edits** – You can manually edit `MEMORY.md` and the index will rebuild on next start

## Scalability Notes

- SQLite FTS5 handles hundreds of thousands of entries without issue
- `MEMORY.md` is capped at `MAX_FACTS` (default 200) entries; oldest are trimmed
- Daily logs are append-only and never trimmed — archive manually if needed
- For very large deployments, swap the SQLite FTS layer for a vector DB (Chroma, Qdrant, pgvector)
