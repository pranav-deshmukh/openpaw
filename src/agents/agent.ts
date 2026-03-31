/**
 * Agent — the core class wrapping one agent's identity, memory, history, and chat loop.
 *
 * Each agent has:
 *   - Its own config (model, allowed tools, isolated flag)
 *   - Its own MemoryManager instance (isolated directory)
 *   - Its own conversation history
 *   - Its own system prompt loaded from a skill file
 *
 * The `chat()` method is the per-agent equivalent of the old global `chatWithTools()`.
 * It filters tools to only those allowed, runs the iterative tool loop (up to 10 rounds),
 * and manages conversation history and memory.
 */

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

import type { AgentConfig } from "./agent-config";
import { MemoryManager } from "../memory/memory-manager";
import { ToolRegistry } from "../tools/tool-registry";
import { executeMemoryTool, memoryTools, memoryOpenAITools } from "../memory/memory-tools";
import { notesTools, executeNotesTool } from "../tools/notes";
import { emailTools, executeEmailTool } from "../tools/email";
import { notionTools, executeNotionTool } from "../tools/notion";

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4, baseDelayMs = 2000): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            const is429 = err?.status === 429 || String(err?.message).includes("429") || String(err?.message).toLowerCase().includes("rate limit");
            if (!is429 || attempt === maxRetries) throw err;
            const delay = baseDelayMs * Math.pow(2, attempt);
            console.log(`⏳ Rate limited. Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastErr;
}



// ─── Agent ────────────────────────────────────────────────────────────────────

export class Agent {
    readonly config: AgentConfig;
    readonly memory: MemoryManager;

    private openai: OpenAI;
    private toolRegistry: ToolRegistry;
    private systemPrompt = "";
    /** Session-partitioned conversation histories. Key = sessionId (e.g. "discord:12345"). */
    private sessionHistories: Map<string, OpenAI.Chat.Completions.ChatCompletionMessageParam[]> = new Map();

    /** All tool definitions this agent is allowed to use in OpenAI format. */
    private agentTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

    /** Set of tool names this agent can use (for fast lookup). */
    private allowedToolNames: Set<string>;

    constructor(config: AgentConfig, openai: OpenAI, toolRegistry: ToolRegistry) {
        this.config = config;
        this.openai = openai;
        this.toolRegistry = toolRegistry;
        this.allowedToolNames = new Set(config.tools);

        this.memory = new MemoryManager({
            dir: config.memory.dir,
            shortTermWindow: config.memory.shortTermWindow,
            maxFacts: config.memory.maxFacts,
        });
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    async init(): Promise<void> {
        // Load skill file as system prompt
        const skillPath = path.join(process.cwd(), this.config.skillFile);
        try {
            this.systemPrompt = await fs.readFile(skillPath, "utf-8");
        } catch (err: any) {
            console.error(`⚠️  Agent "${this.config.id}": Failed to load skill file "${skillPath}": ${err.message}`);
            this.systemPrompt = `You are ${this.config.name}, a helpful AI assistant.`;
        }

        // Init memory
        await this.memory.init();

        // Build the filtered tool list for this agent
        this.buildToolList();

        console.log(`🤖 Agent "${this.config.id}" initialized (${this.agentTools.length} tools, model: ${this.config.model})`);
    }

    /**
     * Build the filtered list of OpenAI tool definitions for this agent.
     * Only includes tools whose names appear in `config.tools`.
     */
    private buildToolList(): void {
        const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

        // Legacy tools (notes, email, notion) — filter by allowed names
        const legacyToolDefs = [...notesTools, ...emailTools, ...notionTools];
        for (const t of legacyToolDefs) {
            if (this.allowedToolNames.has(t.name)) {
                tools.push({
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.input_schema as any,
                    },
                });
            }
        }

        // Memory tools — filter by allowed names
        for (const t of memoryOpenAITools) {
            if (this.allowedToolNames.has(t.function.name)) {
                tools.push(t);
            }
        }

        // Registry-based tools (web search, web fetch, send_message, delegate, etc.)
        for (const t of this.toolRegistry.toOpenAITools()) {
            if (this.allowedToolNames.has(t.function.name)) {
                tools.push(t);
            }
        }

        this.agentTools = tools;
    }

    // ── Tool Execution ────────────────────────────────────────────────────────

    /**
     * Execute a tool by name. Routes to the correct executor based on tool type.
     * Only allows tools that this agent is permitted to use.
     */
    private async executeTool(toolName: string, args: any): Promise<string> {
        if (!this.allowedToolNames.has(toolName)) {
            return `❌ Agent "${this.config.id}" is not allowed to use tool "${toolName}".`;
        }

        // Memory tools — use this agent's own MemoryManager
        if (memoryTools.some((t) => t.name === toolName)) {
            return await executeMemoryTool(this.memory, toolName, args);
        }

        // Email tools
        if (emailTools.some((t) => t.name === toolName)) {
            return await executeEmailTool(toolName, args);
        }

        // Notes tools
        if (notesTools.some((t) => t.name === toolName)) {
            return await executeNotesTool(toolName, args);
        }

        // Notion tools
        if (notionTools.some((t) => t.name === toolName)) {
            return await executeNotionTool(toolName, args);
        }

        // Registry-based tools (web search, web fetch, send_message, delegate, etc.)
        if (this.toolRegistry.has(toolName)) {
            return await this.toolRegistry.execute(toolName, args);
        }

        throw new Error(`Unknown tool: ${toolName}`);
    }

    // ── Chat Loop ─────────────────────────────────────────────────────────────

    /**
     * The core agent chat loop — equivalent to the old `chatWithTools()` function
     * but scoped to this agent's history, memory, model, and allowed tools.
     *
     * @param userInput  The user's message text.
     * @param isolated   If true, run without conversation history (overrides config.isolated).
     */
    async chat(userInput: string, isolated?: boolean, sessionId = "default"): Promise<string> {
        const isIsolated = isolated ?? this.config.isolated;

        // Get or create session-specific history
        if (!this.sessionHistories.has(sessionId)) {
            this.sessionHistories.set(sessionId, []);
        }
        const history = this.sessionHistories.get(sessionId)!;

        // Build memory context block for this query (skip for isolated runs)
        const memoryContext = isIsolated
            ? ""
            : await this.memory.buildContextBlock(userInput, sessionId);

        const systemPrompt = isIsolated
            ? this.systemPrompt
            : this.systemPrompt + memoryContext;

        // Build messages array
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = isIsolated
            ? [
                { role: "system", content: systemPrompt },
                { role: "user", content: userInput },
            ]
            : [
                { role: "system", content: systemPrompt },
                ...history,
                { role: "user", content: userInput },
            ];

        const response = await withRetry<OpenAI.Chat.Completions.ChatCompletion>(() => this.openai.chat.completions.create({
            model: this.config.model,
            messages,
            tools: this.agentTools.length > 0 ? this.agentTools : undefined,
            tool_choice: this.agentTools.length > 0 ? "auto" : undefined,
        }));

        const message = response.choices[0].message;

        if (!isIsolated) {
            history.push({ role: "user", content: userInput });

            // Track in short-term memory
            this.memory.addToShortTerm({
                role: "user",
                content: userInput,
                timestamp: Date.now(),
            }, sessionId);
        }

        /* ---------- Iterative Tool Loop (supports chaining, e.g. search → fetch) ---------- */

        const MAX_TOOL_ROUNDS = 10;
        let currentMessage = message;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (!currentMessage.tool_calls) break;

            if (!isIsolated) history.push(currentMessage);

            for (const call of currentMessage.tool_calls) {
                if (call.type !== "function") continue;

                const toolName = call.function.name;
                const args = JSON.parse(call.function.arguments);

                console.log(`\n🔧 [${this.config.id}] [round ${round + 1}] Using tool: ${toolName}`);

                let result = "";

                try {
                    result = await this.executeTool(toolName, args);
                } catch (err: any) {
                    result = `Tool error: ${err.message}`;
                }

                if (!isIsolated) {
                    history.push({
                        role: "tool",
                        tool_call_id: call.id,
                        content: result,
                    });
                }
            }

            // Ask the LLM again — it may request more tools (e.g. fetch after search)
            const followUp = await withRetry<OpenAI.Chat.Completions.ChatCompletion>(() => this.openai.chat.completions.create({
                model: this.config.model,
                messages: isIsolated
                    ? messages
                    : [{ role: "system", content: systemPrompt }, ...history],
                tools: this.agentTools.length > 0 ? this.agentTools : undefined,
                tool_choice: this.agentTools.length > 0 ? "auto" : undefined,
            }));

            currentMessage = followUp.choices[0].message;

            // If no more tool calls, this is the final text response
            if (!currentMessage.tool_calls) {
                const finalMessage = currentMessage.content || "";

                console.log(`\n[${this.config.id}] ${finalMessage}`);

                if (!isIsolated) {
                    history.push({
                        role: "assistant",
                        content: finalMessage,
                    });

                    this.memory.addToShortTerm({
                        role: "assistant",
                        content: finalMessage,
                        timestamp: Date.now(),
                    }, sessionId);
                }

                return finalMessage;
            }
        }

        /* ---------- Normal response (no tool calls on first pass) ---------- */

        const content = message.content || "";

        console.log(`\n[${this.config.id}] ${content}`);

        if (!isIsolated) {
            history.push({
                role: "assistant",
                content,
            });

            this.memory.addToShortTerm({
                role: "assistant",
                content,
                timestamp: Date.now(),
            }, sessionId);
        }

        return content;
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    /** Clear conversation history for a specific session, or all sessions. */
    clearHistory(sessionId?: string): void {
        if (sessionId) {
            this.sessionHistories.delete(sessionId);
        } else {
            this.sessionHistories.clear();
        }
    }

    /** Get the number of messages in a session's conversation history. */
    historyLength(sessionId = "default"): number {
        return this.sessionHistories.get(sessionId)?.length ?? 0;
    }
}