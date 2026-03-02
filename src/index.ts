import "dotenv/config";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

import { notesTools, executeNotesTool } from "./tools/notes";
import { emailTools, executeEmailTool } from "./tools/email";

import { WebhookServer } from "./server/webhook-server";
import { getLatestEmailSnippet } from "./tools/gmail-webhook";
import { notionTools, executeNotionTool } from "./tools/notion";

import { ToolRegistry } from "./tools/tool-registry";
import { WebSearchTool, WebFetchTool, DuckDuckGoSearchTool } from "./tools/web";
import { SendMessageTool } from "./tools/message";
import { TelegramChannel } from "./channel/telegram";

import { channelRegistry } from "./channel/channel-registry";
import { inboundQueue } from "./queue/message-queue";
import { MessageProcessor } from "./queue/message-processor";
import { CLI } from "./cli/cli";
import crypto from "crypto";

import { memory } from "./memory/memory-manager";
import { memoryOpenAITools, executeMemoryTool, memoryTools } from "./memory/memory-tools";

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
   TOOL REGISTRY (new class-based tools)
===================================================== */

const registry = new ToolRegistry();
registry.register(
  new WebSearchTool(),
  new WebFetchTool(),
  new DuckDuckGoSearchTool(),
  new SendMessageTool(),
);

/* =====================================================
   TOOL DEFINITIONS (for OpenAI)
===================================================== */

// Legacy tools use { name, description, input_schema } — convert to OpenAI format
const legacyTools = [...notesTools, ...emailTools, ...notionTools].map(
  (tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }),
);

// Merge: legacy tools + memory tools + registry-based tools (web, etc.)
const openAITools = [...legacyTools, ...memoryOpenAITools, ...registry.toOpenAITools()];

/* =====================================================
   PROMPTS
===================================================== */

const BASE_SYSTEM_PROMPT = `You are a helpful AI assistant with note-taking, email, memory, and web search capabilities.

MEMORY INSTRUCTIONS:
- At the start of each conversation, search memory for relevant context about the user.
- After learning any important fact about the user (name, preference, goal, project), save it with memory_save.
- When the user asks you to 'remember', 'forget', or 'recall' something, use the memory tools.
- Always prefer to recall from memory before asking the user to repeat themselves.

WEB SEARCH INSTRUCTIONS:
- When the user asks to search, look up, or find something online, or if you need to find something online, use web_search (Brave) or ddg_search (DuckDuckGo).
- After getting search results, ALWAYS use web_fetch on the relevant URL(s) to read the full page content before answering.
- Do NOT just return raw search result snippets. Fetch the actual pages, read them, and give a thorough, well-informed answer.
- If fetching a page fails or is truncated, try another result URL.
- You can call tools in multiple steps: first search, then fetch, then answer.

Use tools when needed. Be concise and helpful. Multiple tools can be used in a single response.`;

let mailSkillPrompt = "";

/* =====================================================
   CHAT HISTORY (only for human conversations)
===================================================== */

const conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

/* =====================================================
   TOOL ROUTER
   Decides which executor handles each tool
===================================================== */

async function executeTool(toolName: string, args: any): Promise<string> {
  // Memory tools
  if (memoryTools.some((t) => t.name === toolName)) {
    return await executeMemoryTool(toolName, args);
  }

  // Email tools
  if (emailTools.some((t) => t.name === toolName)) {
    const result = await executeEmailTool(toolName, args);

    // notify via Telegram after sending
    if (toolName === "send_email") {
      await telegram.sendMessage(result);
    }

    return result;
  }

  // Notes tools
  if (notesTools.some((t) => t.name === toolName)) {
    return await executeNotesTool(toolName, args);
  }

  // Notion tools
  if (notionTools.some((t) => t.name === toolName)) {
    return await executeNotionTool(toolName, args);
  }

  // Registry-based tools (web search, web fetch, etc.)
  if (registry.has(toolName)) {
    return await registry.execute(toolName, args);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

/* =====================================================
   CORE AGENT LOOP
===================================================== */

async function chatWithTools(
  userInput: string,
  isolated = false
): Promise<string> {
  // Build memory context block for this query (skip for isolated email runs)
  const memoryContext = isolated
    ? ""
    : await memory.buildContextBlock(userInput);

  const systemPrompt = isolated
    ? mailSkillPrompt
    : BASE_SYSTEM_PROMPT + memoryContext;

  // isolated runs = email events (no history)
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    isolated
      ? [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ]
      : [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: userInput },
      ];

  const response = await openai.chat.completions.create({
    model: "qwen/qwen3-235b-a22b-thinking-2507",
    messages,
    tools: openAITools,
    tool_choice: "auto",
  });

  const message = response.choices[0].message;

  if (!isolated) {
    conversationHistory.push({ role: "user", content: userInput });

    // Track in short-term memory
    memory.addToShortTerm({
      role: "user",
      content: userInput,
      timestamp: Date.now(),
    });
  }

  /* ---------- Iterative Tool Loop (supports chaining, e.g. search → fetch) ---------- */

  const MAX_TOOL_ROUNDS = 10;
  let currentMessage = message;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (!currentMessage.tool_calls) break;

    if (!isolated) conversationHistory.push(currentMessage);

    for (const call of currentMessage.tool_calls) {
      if (call.type !== "function") continue;

      const toolName = call.function.name;
      const args = JSON.parse(call.function.arguments);

      console.log(`\n🔧 [round ${round + 1}] Using tool: ${toolName}`);

      let result = "";

      try {
        result = await executeTool(toolName, args);
      } catch (err: any) {
        result = `Tool error: ${err.message}`;
      }

      if (!isolated) {
        conversationHistory.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    // Ask the LLM again — it may request more tools (e.g. fetch after search)
    const followUp = await openai.chat.completions.create({
      model: "qwen/qwen3-235b-a22b-thinking-2507",
      messages: isolated
        ? messages
        : [{ role: "system", content: systemPrompt }, ...conversationHistory],
      tools: openAITools,
      tool_choice: "auto",
    });

    currentMessage = followUp.choices[0].message;

    // If no more tool calls, this is the final text response
    if (!currentMessage.tool_calls) {
      const finalMessage = currentMessage.content || "";

      console.log(`\n${finalMessage}`);

      if (!isolated) {
        conversationHistory.push({
          role: "assistant",
          content: finalMessage,
        });

        memory.addToShortTerm({
          role: "assistant",
          content: finalMessage,
          timestamp: Date.now(),
        });
      }

      return finalMessage;
    }
  }

  /* ---------- Normal response ---------- */

  const content = message.content || "";

  console.log(`\n${content}`);

  if (!isolated) {
    conversationHistory.push({
      role: "assistant",
      content,
    });

    memory.addToShortTerm({
      role: "assistant",
      content,
      timestamp: Date.now(),
    });
  }

  return content;
}

/* =====================================================
   EMAIL EVENT PROCESSOR
===================================================== */

async function processEmailEvent(email: any) {
  const emailPrompt = `
New email received:

From: ${email.from}
Subject: ${email.subject}
Preview: ${email.snippet}

Decide whether this is PRIORITY, NOTE, or IGNORE.
Use tools when needed.
`;

  // Enqueue to inbound queue — processed in isolated mode (no history)
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
  // Init memory first
  await memory.init();

  // load email skill prompt
  mailSkillPrompt = await fs.readFile(
    path.join(process.cwd(), "src", "skills", "mail.md"),
    "utf-8"
  );

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

    await processEmailEvent(email);
  });

  webhookServer.start();

  /* ---------- Message Processor ---------- */

  const processor = new MessageProcessor(chatWithTools);
  processor.start();

  console.log("➡️  Expose webhook with: ngrok http 3000");
  /* ---------- CLI ---------- */

  const cli = new CLI();

  cli.registerCommand("/memory", "Show memory stats", async () => {
    const stats = await memory.stats();
    console.log("\n🧠 Memory stats:", JSON.stringify(stats, null, 2));
  });

  cli.onClose(async () => {
    console.log("\n💾 Flushing session to memory...");
    await memory.flushSession();
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