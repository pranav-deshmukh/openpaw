import "dotenv/config";
import OpenAI from "openai";
import crypto from "crypto";

import { ToolRegistry } from "./tools/tool-registry";
import { WebSearchTool, WebFetchTool, DuckDuckGoSearchTool } from "./tools/web";
import { SendMessageTool } from "./tools/message";
import { DelegateToAgentTool } from "./tools/delegate";

import { TelegramChannel } from "./channel/telegram";
import { channelRegistry } from "./channel/channel-registry";
import { inboundQueue } from "./queue/message-queue";
import { MessageProcessor } from "./queue/message-processor";
import { CLI } from "./cli/cli";

import { WebhookServer } from "./server/webhook-server";
import { getLatestEmailSnippet } from "./tools/gmail-webhook";

import { Agent } from "./agents/agent";
import { AgentRegistry } from "./agents/agent-registry";
import { Router } from "./agents/router";
import { agentConfigs, routerRules, defaultAgentId } from "./agents.config";

/* =====================================================
   TELEGRAM CHANNEL
===================================================== */

const telegram = new TelegramChannel();
channelRegistry.register("telegram", telegram);

/* =====================================================
   OPENAI CLIENT
===================================================== */

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

/* =====================================================
   TOOL REGISTRY (global — tools register here, agents filter at call time)
===================================================== */

const toolRegistry = new ToolRegistry();
toolRegistry.register(
  new WebSearchTool(),
  new WebFetchTool(),
  new DuckDuckGoSearchTool(),
  new SendMessageTool(),
);

/* =====================================================
   AGENT REGISTRY
===================================================== */

const agentRegistry = new AgentRegistry();

/* =====================================================
   DELEGATE TOOL — needs the agent registry ref
===================================================== */

const delegateTool = new DelegateToAgentTool(agentRegistry);
toolRegistry.register(delegateTool);

/* =====================================================
   ROUTER
===================================================== */

const router = new Router(routerRules, defaultAgentId);

/* =====================================================
   EMAIL EVENT PROCESSOR
===================================================== */

function processEmailEvent(email: any) {
  const emailPrompt = `
New email received:

From: ${email.from}
Subject: ${email.subject}
Preview: ${email.snippet}

Decide whether this is PRIORITY, NOTE, or IGNORE.
Use tools when needed.
`;

  // Enqueue to inbound queue — router will send it to email-manager
  inboundQueue.enqueue({
    id: crypto.randomUUID(),
    source: "email",
    chatId: "email",
    text: emailPrompt,
    timestamp: Date.now(),
    isolated: true,
  });
}

/* =====================================================
   MAIN APP START
===================================================== */

async function main() {
  // Initialize all agents from config
  console.log("\n🚀 Initializing OpenPaw Multi-Agent System...\n");

  for (const config of agentConfigs) {
    const agent = new Agent(config, openai, toolRegistry);
    await agent.init();
    agentRegistry.register(agent);
  }

  console.log(`\n✅ ${agentConfigs.length} agents initialized: ${agentRegistry.list().join(", ")}\n`);

  /* ---------- Webhook Server ---------- */

  const webhookServer = new WebhookServer(3000);

  webhookServer.onWebhook("gmail", async (data) => {
    console.log("\n📧 New Gmail notification received!");

    const email = await getLatestEmailSnippet(data.historyId);

    if (!email) {
      console.log("No new email details found.");
      return;
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📬 New Email!`);
    console.log(`From: ${email.from}`);
    console.log(`Subject: ${email.subject}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    processEmailEvent(email);
  });

  webhookServer.start();

  /* ---------- Message Processor ---------- */

  const processor = new MessageProcessor(agentRegistry, router);
  processor.start();

  console.log("➡️  Expose webhook with: ngrok http 3000");

  /* ---------- CLI ---------- */

  const cli = new CLI();

  cli.registerCommand("/memory", "Show memory stats (usage: /memory [agentId])", async (args?: string) => {
    const agentId = args?.trim() || defaultAgentId;
    const agent = agentRegistry.get(agentId);

    if (!agent) {
      console.log(`\n❌ Agent "${agentId}" not found. Available: ${agentRegistry.list().join(", ")}`);
      return;
    }

    const stats = await agent.memory.stats();
    console.log(`\n🧠 Memory stats for agent "${agentId}":\n`, JSON.stringify(stats, null, 2));
  });

  cli.registerCommand("/agents", "List all registered agents", () => {
    console.log("\n🤖 Registered Agents:");
    console.log("━".repeat(60));

    for (const agent of agentRegistry.getAll()) {
      const c = agent.config;
      console.log(`  ${c.id.padEnd(18)} ${c.name.padEnd(22)} ${c.tools.length} tools  ${c.isolated ? "(isolated)" : ""}`);
    }

    console.log("━".repeat(60));
  });

  cli.onClose(async () => {
    console.log("\n💾 Flushing all agent sessions to memory...");
    for (const agent of agentRegistry.getAll()) {
      try {
        await agent.memory.flushSession();
      } catch (err: any) {
        console.error(`⚠️  Failed to flush agent "${agent.config.id}":`, err.message);
      }
    }
    console.log("👋 Goodbye!");
  });

  cli.start();
}

/* =====================================================
   TELEGRAM INPUT → INBOUND QUEUE
===================================================== */

telegram.onMessage(async (text, chatId) => {
  inboundQueue.enqueue({
    id: crypto.randomUUID(),
    source: "telegram",
    chatId: String(chatId),
    text,
    timestamp: Date.now(),
  });
});

/* =====================================================
   START
===================================================== */

main();