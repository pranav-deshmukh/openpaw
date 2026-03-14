/**
 * AgentConfig — configuration type for defining an agent.
 *
 * Each agent in the system is described by one of these config objects.
 * Configs are defined in `agents.config.ts` and loaded at startup.
 */

export interface AgentMemoryConfig {
  /** Isolated memory directory for this agent (e.g. "./openpaw-memory/personal"). */
  dir: string;

  /** Sliding window size for short-term memory (default: 20). */
  shortTermWindow: number;

  /** Maximum entries in MEMORY.md (default: 200). */
  maxFacts: number;
}

export interface AgentConfig {
  /** Unique snake_case identifier (e.g. "personal", "email-manager"). */
  id: string;

  /** Human-readable display name. */
  name: string;

  /** OpenRouter model string — can differ per agent. */
  model: string;

  /** Path to the .md skill file used as system prompt (relative to project root). */
  skillFile: string;

  /** Tool names this agent is allowed to use. */
  tools: string[];

  /** Per-agent memory configuration. */
  memory: AgentMemoryConfig;

  /**
   * If true, the agent never uses conversation history.
   * Every invocation is isolated (like the email agent).
   */
  isolated: boolean;

  /** Optional heartbeat configuration for this agent. */
  heartbeat?: {
    enabled: boolean;
    intervalMs: number;
    activeHoursStart?: number;  // 0-23, only fire during these hours
    activeHoursEnd?: number;    // 0-23
    timezone?: string;
  };
}