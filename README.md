# OpenPaw

is a personal AI agent — think of it like having your own locally-run assistant that lives across your tools. You message it on Telegram, it watches your Gmail and reacts to emails automatically, it can save notes, manage Notion, and send you notifications. All of it is driven by one agent loop in TypeScript. You own it completely, it runs on your machine, no SaaS, no subscriptions.

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

## Multi-Agent Architecture

OpenPaw features a flexible multi-agent architecture that allows for isolated "identities" to coexist within the same process. Each agent has its own configuration, personality (Skill), memory store, and conversation history.

### Core Components

- **`Agent`**: The core execution unit. Keeps track of its own conversation history and manages its own `MemoryManager` instance.
- **`AgentRegistry`**: A central registry where all instantiated agents are stored and retrieved by their unique ID (e.g., `personal`, `researcher`).
- **`Router`**: Determines which agent should handle an incoming message based on configurable `RouterRule`s (source channel, chatId).
- **`AgentConfig`**: A structured definition for each agent, specifying the LLM model, skill file (system prompt), allowed tools, and memory settings.

### How It Works

1.  **Incoming Message**: A message arrives from Telegram, CLI, or an Email Webhook.
2.  **Routing**: The `Router` matches the message metadata against its rules to find the correct `agentId`.
3.  **Dispatching**: The `MessageProcessor` retrieves the corresponding `Agent` from the `AgentRegistry`.
4.  **Execution**: The agent runs its own chat loop, including up to 10 rounds of iterative tool calling. It uses its isolated memory and conversation history.
5.  **Response**: The agent's response is enqueued in the `OutboundQueue` for delivery back to the originating channel.

### Agent Delegation

Agents can hand off specialized work to each other using the `delegate_to_agent` tool. For example, the `personal` agent can delegate a complex research task to the `researcher` agent.

- **Synchronous Delegation**: The calling agent waits for the target agent to finish and receives the result as a tool output.
- **Asynchronous Delegation**: The calling agent continues immediately; the target agent processes the task independently.

### Isolated Memory

Each agent maintains its own isolated memory directory:

```
openpaw-memory/
├── personal/          ← Personal assistant facts & logs
├── researcher/        ← Researcher-specific data (if any)
└── email-manager/     ← Isolated email processing context
```

This ensures that different agents don't leak context to each other unless explicitly shared via delegation or tool outputs.

### Adding New Agents

New agents are defined in `src/agents.config.ts`. Simply add a new `AgentConfig` object to the `agentConfigs` array and define matching routing rules in `routerRules`.
