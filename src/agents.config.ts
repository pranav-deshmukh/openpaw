/**
 * Agent configurations and routing rules for OpenPaw.
 */

import type { AgentConfig } from "./agents/agent-config";
import type { RouterRule } from "./agents/router";

export const agentConfigs: AgentConfig[] = [
    {
        id: "personal",
        name: "Personal Assistant",
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        skillFile: "src/skills/personal.md",
        tools: [
            "add_note", "search_notes", "list_notes", "clear_all_notes",
            "create_email_draft", "show_email_draft", "send_email",
            "notion_add_item",
            "memory_save", "memory_search", "memory_list", "memory_forget", "memory_stats",
            "web_search", "ddg_search", "web_fetch",
            "send_message",
            "delegate_to_agent",
            "schedule_at", "schedule_every", "schedule_cron", "schedule_list", "schedule_delete",
        ],
        memory: {
            dir: "./openpaw-memory/personal",
            shortTermWindow: 20,
            maxFacts: 200,
        },
        isolated: false,
        heartbeat: {
            enabled: true,
            intervalMs: 30 * 60 * 1000,
            activeHoursStart: 8,
            activeHoursEnd: 22,
            timezone: "Asia/Kolkata",
        },
    },

    {
        id: "email-manager",
        name: "Email Manager",
        model: "nvidia/nemotron-3-super-120b-a12b:free",
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
        model: "nvidia/nemotron-3-super-120b-a12b:free",
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

export const routerRules: RouterRule[] = [
    { source: "email", agentId: "email-manager" },
    { source: "scheduler", agentId: "personal" },
    { source: "*", agentId: "personal" },
];

export const defaultAgentId = "personal";