/**
 * Agent configurations and routing rules for OpenPaw.
 *
 * Define all agents and their properties here.
 * To add a new agent, simply add an entry to `agentConfigs`.
 * To change routing, modify `routerRules`.
 */

import type { AgentConfig } from "./agents/agent-config";
import type { RouterRule } from "./agents/router";

// ── Agent Definitions ────────────────────────────────────────────────────────

export const agentConfigs: AgentConfig[] = [
    {
        id: "personal",
        name: "Personal Assistant",
        model: "qwen/qwen3-235b-a22b-thinking-2507",
        skillFile: "src/skills/personal.md",
        tools: [
            // Notes
            "add_note", "search_notes", "list_notes", "clear_all_notes",
            // Email
            "create_email_draft", "show_email_draft", "send_email",
            // Notion
            "notion_add_item",
            // Memory
            "memory_save", "memory_search", "memory_list", "memory_forget", "memory_stats",
            // Web
            "web_search", "ddg_search", "web_fetch",
            // Messaging
            "send_message",
            // Delegation
            "delegate_to_agent",
        ],
        memory: {
            dir: "./openpaw-memory/personal",
            shortTermWindow: 20,
            maxFacts: 200,
        },
        isolated: false,
    },

    {
        id: "email-manager",
        name: "Email Manager",
        model: "qwen/qwen3-235b-a22b-thinking-2507",
        skillFile: "src/skills/mail.md",
        tools: [
            "send_message",
            "add_note",
            "notion_add_item",
        ],
        memory: {
            dir: "./openpaw-memory/email-manager",
            shortTermWindow: 5,
            maxFacts: 50,
        },
        isolated: true,
    },

    {
        id: "researcher",
        name: "Researcher",
        model: "qwen/qwen3-235b-a22b-thinking-2507",
        skillFile: "src/skills/researcher.md",
        tools: [
            "web_search",
            "ddg_search",
            "web_fetch",
            "send_message",
        ],
        memory: {
            dir: "./openpaw-memory/researcher",
            shortTermWindow: 10,
            maxFacts: 50,
        },
        isolated: false,
    },
];

// ── Routing Rules ────────────────────────────────────────────────────────────

export const routerRules: RouterRule[] = [
    { source: "email", agentId: "email-manager" },
    { source: "*", agentId: "personal" },     // default fallback
];

// ── Default Agent ────────────────────────────────────────────────────────────

export const defaultAgentId = "personal";
