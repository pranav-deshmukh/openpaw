# OpenPaw — Scheduler & Heartbeat Implementation Prompt

## Current Codebase State

The project is a fully working multi-agent TypeScript system. Here is exactly what exists so you do not rewrite anything unnecessarily:

### Architecture Overview

**Entry point:** `src/index.ts` — bootstraps agents from config, creates registries, starts processor and CLI.

**Agent system (`src/agents/`):**
- `agent-config.ts` — `AgentConfig` interface with `id`, `name`, `model`, `skillFile`, `tools[]`, `memory{}`, `isolated`
- `agent.ts` — `Agent` class with its own `MemoryManager`, `conversationHistory`, `systemPrompt`, `buildToolList()`, `executeTool()`, and `chat(text, isolated?)` method with 10-round iterative tool loop
- `agent-registry.ts` — `AgentRegistry` class: `register()`, `get()`, `has()`, `list()`, `getAll()`
- `router.ts` — `Router` class: `RouterRule { source, chatId?, agentId }`, `resolve(msg)` method — explicit `agentId` on message takes priority, then rules, then default

**Queue system (`src/queue/`):**
- `message-types.ts` — `InboundMessage { id, source, chatId, text, timestamp, isolated?, agentId? }`, `OutboundMessage`, `ReplyContext { source, chatId, agentId }`, `setReplyContext()`, `getReplyContext()`
- `message-queue.ts` — generic `MessageQueue<T>` class, two singletons: `inboundQueue` and `outboundQueue`
- `message-processor.ts` — `MessageProcessor(agentRegistry, router)` with two polling loops at 100ms: inbound (runs agent) and outbound (delivers replies)

**Tools (`src/tools/`):**
- `base-tool.ts` — `abstract BaseTool` with `name`, `description`, `parameters`, `execute()`, `toOpenAI()`
- `tool-registry.ts` — `ToolRegistry` class: `register()`, `has()`, `execute()`, `toOpenAITools()`
- `web.ts` — `WebSearchTool` (Brave API), `DuckDuckGoSearchTool` (no key), `WebFetchTool` — all extend `BaseTool`
- `message.ts` — `SendMessageTool` extends `BaseTool`, reads `ReplyContext`, enqueues to `outboundQueue`
- `delegate.ts` — `DelegateToAgentTool(agentRegistry)` extends `BaseTool`, calls `agent.chat()` directly for `awaitResult=true`
- Legacy tools (notes, email, notion) — plain objects with `{ name, description, input_schema }`, executed via switch/case in `Agent.executeTool()`

**Memory (`src/memory/`):**
- `memory-manager.ts` — `MemoryManager(config: { dir, shortTermWindow?, maxFacts? })` — each agent has its own instance. Three layers: short-term sliding window, `MEMORY.md` long-term, SQLite FTS5 index with BM25. Key methods: `init()`, `save()`, `search()`, `forget()`, `buildContextBlock()`, `flushSession()`, `stats()`
- `memory-tools.ts` — `executeMemoryTool(memory: MemoryManager, toolName, args)` — takes the agent's own memory instance

**Channels (`src/channel/`):**
- `base-channel.ts` — `MessageChannel` interface: `sendMessage()`, `sendToChat(chatId, message)`
- `channel-registry.ts` — `ChannelRegistry` singleton
- `telegram.ts` — `TelegramChannel` implements `MessageChannel`, handles polling + MarkdownV2 conversion + message splitting

**CLI (`src/cli/cli.ts`):**
- `CLI` class with `registerCommand(cmd, description, handler: (args?: string) => void)` — already supports arguments
- Built-in commands: `/help`, `/status`, `/quit`, `/exit`, `/clear`
- External commands registered from `index.ts`: `/memory [agentId]`, `/agents`

**Config (`src/agents.config.ts`):**
Three agents defined:
- `personal` — model `qwen/qwen3-235b-a22b-thinking-2507`, all tools including `delegate_to_agent`, memory at `./openpaw-memory/personal`, not isolated
- `email-manager` — `send_message`, `add_note`, `notion_add_item` only, memory at `./openpaw-memory/email-manager`, isolated
- `researcher` — web search tools + `send_message`, memory at `./openpaw-memory/researcher`, not isolated

Router rules: `email → email-manager`, `* → personal`

**Skills (`src/skills/`):** `personal.md`, `mail.md`, `researcher.md`, `note-taking.md`, `email-writing.md`, `notion.md`

**Existing npm dependencies:** `openai`, `dotenv`, `better-sqlite3`, `express`, `googleapis`, `node-telegram-bot-api`, `@notionhq/client`

**No test suite exists.** TypeScript strict compilation (`npx tsc --noEmit`) is the verification step.

---

## What To Build: Scheduler + Heartbeat

Two distinct but related features that share the same underlying `Scheduler` engine.

### Concept

**Scheduler** — a timer-based engine that fires `InboundMessage`s into the existing `inboundQueue` at configured times. The existing `MessageProcessor` picks them up exactly like any other message — no special handling needed. `source` will be `"scheduler"` so the outbound loop knows not to try to deliver responses to a user channel (scheduler-triggered agent outputs go to Telegram via `send_message` tool, not via the normal outbound delivery path).

**Heartbeat** — a recurring scheduled job, one per agent that has it enabled, that asks the agent to check on things. If the agent has nothing to report it replies `HEARTBEAT_OK` and the output is silently dropped. If it has something to say it calls `send_message` to notify the user on Telegram.

**Cron jobs** — user-defined scheduled tasks. Created by the agent itself using scheduler tools (e.g. "remind me about my flight at 3am"), or defined statically in config. Support three schedule types: recurring cron expression, recurring interval, one-shot datetime.

---

## Files To Create

### `src/scheduler/scheduler-types.ts`

Type definitions only. No logic.

```typescript
export type ScheduleKind =
  | { kind: "cron";    expr: string }          // standard cron: "0 7 * * *"
  | { kind: "every";   intervalMs: number }    // interval in ms: 30 * 60 * 1000
  | { kind: "at";      isoTime: string };      // one-shot ISO datetime

export interface ScheduledJob {
  id: string;                  // uuid
  name: string;                // human-readable label
  schedule: ScheduleKind;
  agentId: string;             // which agent handles it
  message: string;             // what text to send to the agent
  isolated: boolean;           // true = no history (default true for scheduler jobs)
  timezone?: string;           // e.g. "Asia/Kolkata" — used for display only, times are stored as UTC
  enabled: boolean;
  deleteAfterRun?: boolean;    // true for one-shot jobs
  lastRunAt?: number;          // unix ms
  nextRunAt: number;           // unix ms — pre-computed, updated after each run
  createdAt: number;           // unix ms
  isHeartbeat?: boolean;       // true = suppress output if agent replies HEARTBEAT_OK
}
```

### `src/scheduler/cron-utils.ts`

Utility functions for computing `nextRunAt`. Install and use the `cron-parser` npm package for cron expression support.

```
npm install cron-parser
npm install --save-dev @types/cron-parser
```

Export these functions:

```typescript
// Parse "30m", "1h", "6h", "1d" → milliseconds
export function parseIntervalString(s: string): number

// Given a cron expression and a reference time, compute next fire time as unix ms
// Use cron-parser: CronExpressionParser.parse(expr).next().getTime()
export function nextCronMs(expr: string, from?: Date): number

// Given a ScheduledJob, compute its next nextRunAt from now
export function computeNextRun(job: ScheduledJob): number
```

### `src/scheduler/scheduler.ts`

The core scheduler engine. Class-based, follows the same pattern as `ToolRegistry`, `AgentRegistry`, `ChannelRegistry`.

```typescript
export class Scheduler {
  private jobs = new Map<string, ScheduledJob>();
  private timer: NodeJS.Timeout | null = null;
  private readonly TICK_MS = 10_000;        // check every 10 seconds
  private readonly persistPath: string;     // path to scheduler.json

  constructor(persistPath = "./openpaw-memory/scheduler.json") {}

  // Load jobs from disk on startup — call this before start()
  async load(): Promise<void>

  // Persist current jobs to disk — call after any mutation
  private async persist(): Promise<void>

  // Add a job. Computes nextRunAt, saves to disk.
  async addJob(job: Omit<ScheduledJob, "id" | "createdAt" | "nextRunAt">): Promise<ScheduledJob>

  // Remove a job by ID
  async removeJob(id: string): Promise<boolean>

  // Enable or disable a job
  async setEnabled(id: string, enabled: boolean): Promise<boolean>

  // Get all jobs
  listJobs(): ScheduledJob[]

  // Get a job by ID
  getJob(id: string): ScheduledJob | undefined

  // Start the tick loop
  start(): void

  // Stop the tick loop
  stop(): void

  // Internal tick — called every TICK_MS
  // Finds due jobs (nextRunAt <= Date.now() && enabled),
  // fires them via onFire callback, updates nextRunAt or deletes if deleteAfterRun
  private async tick(): Promise<void>

  // Callback set by index.ts — fires when a job is due
  onFire?: (job: ScheduledJob) => void
}

export const scheduler = new Scheduler();  // singleton
```

**Persistence:** jobs are stored as a JSON array in `scheduler.json`. On load, recompute `nextRunAt` for any jobs whose `nextRunAt` is in the past (they may have been missed during downtime) — for `every` and `cron` jobs, recompute from now. For `at` jobs that are past due, run them immediately once then delete.

**Tick logic:**
```
every tick:
  for each enabled job where nextRunAt <= Date.now():
    fire onFire(job)
    if deleteAfterRun: removeJob(id)
    else: job.nextRunAt = computeNextRun(job), job.lastRunAt = now, persist()
```

### `src/scheduler/heartbeat.ts`

Manages the per-agent heartbeat jobs. Not a class — just an init function called from `index.ts`.

```typescript
export interface HeartbeatConfig {
  agentId: string;
  intervalMs: number;             // e.g. 30 * 60 * 1000 for 30 minutes
  activeHoursStart?: number;      // 0-23, skip heartbeat outside these hours
  activeHoursEnd?: number;        // 0-23
  message?: string;               // override default heartbeat message
}

// Register heartbeat jobs in the scheduler for agents that have it configured
export async function initHeartbeats(
  configs: HeartbeatConfig[],
  scheduler: Scheduler
): Promise<void>

// Check if an agent response is a silent heartbeat (nothing to report)
export function isHeartbeatOk(response: string): boolean
// Returns true if response is exactly "HEARTBEAT_OK" or starts with it
// trimmed and case-insensitive
```

The default heartbeat message sent to the agent:

```
[HEARTBEAT] Time to check in. Review your checklist below and act if needed.
If nothing requires attention, reply with exactly: HEARTBEAT_OK

Checklist:
- Are there any urgent tasks or reminders due soon?
- Is there anything important the user should know right now?
- Any pending actions from previous sessions?

If everything is fine, reply HEARTBEAT_OK and nothing else.
```

### `src/scheduler/scheduler-tools.ts`

Five tools the agent can call to manage its own schedule. All extend `BaseTool`.

```typescript
export class ScheduleCronTool extends BaseTool   // name: "schedule_cron"
export class ScheduleAtTool extends BaseTool     // name: "schedule_at"
export class ScheduleEveryTool extends BaseTool  // name: "schedule_every"
export class ScheduleListTool extends BaseTool   // name: "schedule_list"
export class ScheduleDeleteTool extends BaseTool // name: "schedule_delete"
```

Each tool takes the `Scheduler` singleton in its constructor.

**`schedule_cron` parameters:**
```json
{
  "name": "string — human label e.g. 'Morning briefing'",
  "expr": "string — standard 5-field cron expression e.g. '0 7 * * *'",
  "message": "string — what to tell the agent when this fires",
  "agentId": "string — which agent runs it (optional, defaults to personal)",
  "timezone": "string — for display only e.g. 'Asia/Kolkata' (optional)"
}
```

**`schedule_at` parameters:**
```json
{
  "name": "string — e.g. 'Flight reminder'",
  "isoTime": "string — ISO 8601 datetime e.g. '2024-12-25T03:00:00+05:30'",
  "message": "string — what to tell the agent when this fires",
  "agentId": "string — optional, defaults to personal"
}
```
`deleteAfterRun` is always `true` for `schedule_at` jobs — one-shot.

**`schedule_every` parameters:**
```json
{
  "name": "string — e.g. 'Hourly check'",
  "interval": "string — e.g. '30m', '1h', '6h', '1d'",
  "message": "string — what to tell the agent",
  "agentId": "string — optional, defaults to personal"
}
```

**`schedule_list` parameters:** none. Returns a formatted list of all jobs with id, name, schedule, agentId, enabled, nextRunAt.

**`schedule_delete` parameters:**
```json
{ "id": "string — job ID to delete" }
```

All tools return a human-readable success/error string.

---

## Files To Modify

### `src/agents.config.ts`

Add `heartbeat` field to `AgentConfig` (optional). Add it to the `personal` agent:

```typescript
heartbeat?: {
  enabled: boolean;
  intervalMs: number;
  activeHoursStart?: number;
  activeHoursEnd?: number;
}
```

Update the `personal` agent config:
```typescript
heartbeat: {
  enabled: true,
  intervalMs: 30 * 60 * 1000,  // 30 minutes
  activeHoursStart: 8,
  activeHoursEnd: 22,
}
```

Add scheduler tools to `personal` agent's tools list:
```typescript
"schedule_cron", "schedule_at", "schedule_every", "schedule_list", "schedule_delete"
```

### `src/agents/agent-config.ts`

Add optional `heartbeat` field to `AgentConfig` interface matching the type above.

### `src/queue/message-types.ts`

Add one field to `InboundMessage`:
```typescript
isHeartbeat?: boolean;   // true = suppress output if agent replies HEARTBEAT_OK
```

No other changes to this file.

### `src/queue/message-processor.ts`

In `processNext()`, after getting the agent response, add heartbeat suppression check before enqueuing to outbound:

```typescript
// After: const response = await agent.chat(msg.text, msg.isolated);

// Suppress heartbeat responses that are just HEARTBEAT_OK
if (msg.isHeartbeat && isHeartbeatOk(response)) {
  console.log(`💓 [${agentId}] Heartbeat OK — nothing to report.`);
  setReplyContext(null);
  return;
}

// existing: if (response && msg.source !== "email") { outboundQueue.enqueue(...) }
// ALSO suppress outbound delivery for scheduler source (agent uses send_message tool instead)
if (response && msg.source !== "email" && msg.source !== "scheduler") {
  outboundQueue.enqueue({ ... });
}
```

Import `isHeartbeatOk` from `../scheduler/heartbeat`.

### `src/index.ts`

**Imports to add:**
```typescript
import { scheduler } from "./scheduler/scheduler";
import { initHeartbeats } from "./scheduler/heartbeat";
import { ScheduleCronTool, ScheduleAtTool, ScheduleEveryTool, ScheduleListTool, ScheduleDeleteTool } from "./scheduler/scheduler-tools";
```

**In `main()`, after agents are initialized, add:**

```typescript
// Load persisted scheduler jobs
await scheduler.load();

// Register scheduler tools in the global tool registry
toolRegistry.register(
  new ScheduleCronTool(scheduler),
  new ScheduleAtTool(scheduler),
  new ScheduleEveryTool(scheduler),
  new ScheduleListTool(scheduler),
  new ScheduleDeleteTool(scheduler),
);

// Wire scheduler to fire into the inbound queue
scheduler.onFire = (job) => {
  console.log(`\n⏰ Scheduler firing: "${job.name}" → agent "${job.agentId}"`);
  inboundQueue.enqueue({
    id: crypto.randomUUID(),
    source: "scheduler",
    chatId: job.agentId,
    text: job.message,
    agentId: job.agentId,
    isolated: job.isolated,
    timestamp: Date.now(),
    isHeartbeat: job.isHeartbeat ?? false,
  });
};

// Start scheduler
scheduler.start();

// Init heartbeats for agents that have it configured
const heartbeatConfigs = agentConfigs
  .filter(c => c.heartbeat?.enabled)
  .map(c => ({
    agentId: c.id,
    intervalMs: c.heartbeat!.intervalMs,
    activeHoursStart: c.heartbeat!.activeHoursStart,
    activeHoursEnd: c.heartbeat!.activeHoursEnd,
  }));

await initHeartbeats(heartbeatConfigs, scheduler);
```

**Add `/scheduler` CLI command:**
```typescript
cli.registerCommand("/scheduler", "List all scheduled jobs", () => {
  const jobs = scheduler.listJobs();
  if (jobs.length === 0) {
    console.log("\n⏰ No scheduled jobs.");
    return;
  }
  console.log("\n⏰ Scheduled Jobs:");
  console.log("━".repeat(70));
  for (const job of jobs) {
    const next = new Date(job.nextRunAt).toLocaleString();
    const status = job.enabled ? "✅" : "⏸️";
    console.log(`  ${status} [${job.id.slice(0, 8)}] ${job.name.padEnd(25)} → ${job.agentId.padEnd(15)} next: ${next}`);
  }
  console.log("━".repeat(70));
});
```

**In `cli.onClose()`, add before the goodbye:**
```typescript
scheduler.stop();
```

### `src/skills/personal.md`

Add a section at the end:

```markdown
## SCHEDULER INSTRUCTIONS
- When the user asks to be reminded about something at a specific time, use schedule_at.
- When the user asks for recurring reminders or scheduled tasks, use schedule_cron or schedule_every.
- Use schedule_list to show the user what is scheduled.
- Use schedule_delete to remove a job the user no longer wants.
- For one-time reminders, always set deleteAfterRun (schedule_at does this automatically).
- When a scheduled job fires and you need to notify the user, use send_message.
- Timezone: default to the user's timezone if known from memory, otherwise ask once and remember it.

## HEARTBEAT INSTRUCTIONS
- When you receive a [HEARTBEAT] message, check your checklist carefully.
- If there is nothing urgent or noteworthy, reply with exactly: HEARTBEAT_OK
- If there IS something to report, use send_message to notify the user, then reply with a brief summary.
- Do NOT reply HEARTBEAT_OK if you send a notification — reply with what you did instead.
```

---

## What Must NOT Change

| File | Reason |
|---|---|
| `src/agents/agent.ts` | No changes needed — scheduler messages arrive as normal InboundMessages |
| `src/agents/agent-registry.ts` | Unchanged |
| `src/agents/router.ts` | Unchanged — `agentId` on message already bypasses rules |
| `src/queue/message-queue.ts` | Unchanged |
| `src/channel/` | All unchanged |
| `src/tools/base-tool.ts` | Unchanged |
| `src/tools/tool-registry.ts` | Unchanged |
| `src/tools/web.ts` | Unchanged |
| `src/tools/message.ts` | Unchanged |
| `src/tools/delegate.ts` | Unchanged |
| `src/tools/notes.ts` | Unchanged |
| `src/tools/email.ts` | Unchanged |
| `src/tools/notion.ts` | Unchanged |
| `src/memory/` | Both files unchanged |
| `src/cli/cli.ts` | Unchanged |
| `src/skills/mail.md` | Unchanged |
| `src/skills/researcher.md` | Unchanged |

---

## End-to-End Flow Examples

### Flight Reminder

```
User: "Remind me about my flight at 3am on December 25th IST"

personal agent: calls schedule_at({
  name: "Flight reminder",
  isoTime: "2024-12-25T03:00:00+05:30",
  message: "Flight reminder: the user asked to be reminded about their flight right now.",
  agentId: "personal"
})

Agent replies: "Done, I'll remind you at 3am on December 25th IST."

--- December 25th, 03:00:00 IST ---

scheduler.tick() detects job is due
scheduler.onFire(job) fires
inboundQueue.enqueue({ source: "scheduler", agentId: "personal", text: "Flight reminder: ...", isHeartbeat: false })
MessageProcessor picks it up → personal agent.chat()
Agent calls send_message("⏰ Flight reminder! You have a flight today.")
SendMessageTool enqueues to outboundQueue → Telegram delivers to user
Agent returns text response → suppressed (source === "scheduler")
Job deleted (deleteAfterRun: true)
```

### Morning Briefing Cron

```
User: "Give me a morning briefing every day at 7am"

personal agent: calls schedule_cron({
  name: "Morning briefing",
  expr: "0 7 * * *",
  message: "Good morning! Please give the user a brief morning summary: any important reminders, tasks due today, and a motivational note.",
  agentId: "personal"
})

--- 07:00:00 every day ---

Scheduler fires → personal agent receives message
Agent checks memory for tasks/reminders, composes briefing
Agent calls send_message("Good morning! Here's your briefing: ...")
User receives Telegram message
Agent text response suppressed (source === "scheduler")
nextRunAt updated to tomorrow 07:00:00
```

### Heartbeat

```
--- 30 minutes pass, activeHoursStart=8, activeHoursEnd=22, current time 14:30 ---

Scheduler fires heartbeat job for personal agent
inboundQueue.enqueue({ source: "scheduler", agentId: "personal", isHeartbeat: true, text: "[HEARTBEAT] ..." })
personal agent.chat() runs
Agent checks: nothing urgent
Agent replies: "HEARTBEAT_OK"
MessageProcessor: isHeartbeatOk("HEARTBEAT_OK") → true
Console logs: "💓 [personal] Heartbeat OK — nothing to report."
Nothing delivered to user. Silent.

--- Next heartbeat, agent notices a task is due ---

Agent replies: "Sent flight reminder notification" (after calling send_message)
isHeartbeatOk check fails → response is not suppressed
(But source is "scheduler" so outbound delivery is also suppressed — only send_message delivers)
```

---

## New File Structure

```
src/
  scheduler/
    scheduler-types.ts     ← ScheduleKind, ScheduledJob interfaces
    cron-utils.ts          ← parseIntervalString, nextCronMs, computeNextRun
    scheduler.ts           ← Scheduler class + singleton export
    heartbeat.ts           ← initHeartbeats(), isHeartbeatOk()
    scheduler-tools.ts     ← 5 tool classes extending BaseTool
```

---

## npm Package to Install

```bash
npm install cron-parser
npm install --save-dev @types/cron-parser
```

No other new dependencies.

---

## Verification

Run `npx tsc --noEmit` — must pass with zero errors.

Manual checks:
1. Start with `npm run dev` — confirm each agent memory initializes, scheduler loads, heartbeat jobs register
2. Run `/scheduler` — confirm it lists heartbeat job for personal agent
3. Say "remind me to check something in 2 minutes" — agent calls `schedule_every` or `schedule_at`, run `/scheduler` to confirm it registered, wait 2 minutes, confirm Telegram notification arrives
4. Run `/scheduler` again — one-shot job should be gone
5. Wait 30 minutes (or temporarily set heartbeat interval to 1 minute for testing) — confirm `💓 [personal] Heartbeat OK` appears in console with no Telegram message
6. Confirm `./openpaw-memory/scheduler.json` exists and contains the jobs
7. Restart the process — confirm jobs reload from `scheduler.json` and heartbeat re-registers without duplicating