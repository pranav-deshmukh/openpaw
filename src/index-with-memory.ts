/**
 * OpenPaw index.ts – with persistent memory integrated
 *
 * Changes from original:
 *   1. Import memory + memory tools
 *   2. Init memory before starting
 *   3. Inject memory context into system prompt
 *   4. Route memory tool calls
 *   5. Track short-term history in memory manager
 *   6. Flush session on exit
 */

import "dotenv/config";
import readline from "readline";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import TelegramBot from "node-telegram-bot-api";

import { notesTools, executeNotesTool } from "./tools/notes";
import { emailTools, executeEmailTool } from "./tools/email";
import { telegramTool, sendTelegramMessage } from "./tools/telegram";
import { WebhookServer } from "./server/webhook-server";
import { getLatestEmailSnippet } from "./tools/gmail-webhook";
import { notionTools, executeNotionTool } from "./tools/notion";

// ✨ Memory
import { memory } from "./memory/memory-manager";
import {
  memoryOpenAITools,
  executeMemoryTool,
  memoryTools,
} from "./memory/memory-tools";

/* TELEGRAM BOT*/

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
  polling: true,
});

/* OPENAI CLIENT */

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

/*TOOL DEFINITIONS*/

const openAITools = [
  ...notesTools,
  telegramTool,
  ...emailTools,
  ...notionTools,
  // ✨ memory tools registered here
  ...memoryOpenAITools,
].map((tool) =>
  // tools already in OpenAI format just pass through
  "function" in tool
    ? tool
    : {
        type: "function" as const,
        function: {
          name: (tool as any).name,
          description: (tool as any).description,
          parameters: (tool as any).input_schema,
        },
      },
);

/* PROMPTS */

const BASE_SYSTEM_PROMPT =
  "You are a helpful AI assistant with note-taking, email, and memory capabilities.\n\n" +
  "MEMORY INSTRUCTIONS:\n" +
  "- At the start of each conversation, search memory for relevant context about the user.\n" +
  "- After learning any important fact about the user (name, preference, goal, project), save it with memory_save.\n" +
  "- When the user asks you to 'remember', 'forget', or 'recall' something, use the memory tools.\n" +
  "- Always prefer to recall from memory before asking the user to repeat themselves.\n" +
  "Use tools when needed. Be concise and helpful.";

let mailSkillPrompt = "";

/* CHAT HISTORY  (short-term, in-process)*/

const conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
  [];

/* TOOL ROUTER */

async function executeTool(toolName: string, args: any): Promise<string> {
  // ✨ Memory tools
  if (memoryTools.some((t) => t.name === toolName)) {
    return await executeMemoryTool(toolName, args);
  }

  // Email tools
  if (emailTools.some((t) => t.name === toolName)) {
    const result = await executeEmailTool(toolName, args);
    if (toolName === "send_email") await sendTelegramMessage(result);
    return result;
  }

  // Telegram tool
  if (toolName === "send_telegram_message") {
    return await sendTelegramMessage(args.message);
  }

  // Notes tools
  if (notesTools.some((t) => t.name === toolName)) {
    return await executeNotesTool(toolName, args);
  }

  // Notion tools
  if (notionTools.some((t) => t.name === toolName)) {
    return await executeNotionTool(toolName, args);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

/* CORE AGENT LOOP*/

async function chatWithTools(
  userInput: string,
  isolated = false,
): Promise<string> {
  // ✨ Build memory context block for this query
  const memoryContext = isolated
    ? ""
    : await memory.buildContextBlock(userInput);

  const systemPrompt = isolated
    ? mailSkillPrompt
    : BASE_SYSTEM_PROMPT + memoryContext;

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
    model: "openai/gpt-4o-mini",
    messages,
    tools: openAITools,
    tool_choice: "auto",
  });

  const message = response.choices[0].message;

  if (!isolated) {
    conversationHistory.push({ role: "user", content: userInput });

    // ✨ Track in short-term memory
    memory.addToShortTerm({
      role: "user",
      content: userInput,
      timestamp: Date.now(),
    });
  }

  /* ---------- Tool Calls ---------- */

  if (message.tool_calls) {
    if (!isolated) conversationHistory.push(message);

    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;

      const toolName = call.function.name;
      const args = JSON.parse(call.function.arguments);

      console.log(`\n🔧 Using tool: ${toolName}`);

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

    const followUp = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: isolated
        ? messages
        : [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
          ],
    });

    const finalMessage = followUp.choices[0].message.content || "";
    console.log(`\n${finalMessage}`);

    if (!isolated) {
      conversationHistory.push({ role: "assistant", content: finalMessage });

      // ✨ Track assistant reply in short-term memory
      memory.addToShortTerm({
        role: "assistant",
        content: finalMessage,
        timestamp: Date.now(),
      });
    }

    return finalMessage;
  }

  /* ---------- Normal response ---------- */

  const content = message.content || "";
  console.log(`\n${content}`);

  if (!isolated) {
    conversationHistory.push({ role: "assistant", content });

    memory.addToShortTerm({
      role: "assistant",
      content,
      timestamp: Date.now(),
    });
  }

  return content;
}

/* EMAIL EVENT PROCESSOR*/

async function processEmailEvent(email: any) {
  const emailPrompt = `
New email received:

From: ${email.from}
Subject: ${email.subject}
Preview: ${email.snippet}

Decide whether this is PRIORITY, NOTE, or IGNORE.
Use tools when needed.
`;
  await chatWithTools(emailPrompt, true);
}

/* MAIN*/

async function main() {
  // ✨ Init memory FIRST
  await memory.init();

  // Load skill prompts
  mailSkillPrompt = await fs.readFile(
    path.join(process.cwd(), "src", "skills", "mail.md"),
    "utf-8",
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

  console.log("Expose webhook with: ngrok http 3000");
  console.log("🧠 Memory system active");
  console.log(" Agent Running...");
  console.log("━".repeat(50));

  /* ---------- CLI ---------- */

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\n> ",
  });

  rl.prompt();

  rl.on("line", async (input) => {
    const userInput = input.trim();
    if (!userInput) return rl.prompt();

    if (userInput.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    // ✨ Dev command: show memory stats
    if (userInput.toLowerCase() === "/memory") {
      const stats = await memory.stats();
      console.log("\n🧠 Memory stats:", JSON.stringify(stats, null, 2));
      return rl.prompt();
    }

    try {
      await chatWithTools(userInput);
    } catch (err: any) {
      console.error(" Error:", err.message);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    // ✨ Flush session to memory on exit
    console.log("\n💾 Flushing session to memory...");
    await memory.flushSession();
    console.log("👋 Goodbye!");
    process.exit(0);
  });
}

/* TELEGRAM INPUT → AGENT */

bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text) return;
  const response = await chatWithTools(text);
  await bot.sendMessage(msg.chat.id, response);
});

/* START*/

main();