import "dotenv/config";
import readline from "readline";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import TelegramBot from "node-telegram-bot-api";

import { notesTools, executeNotesTool } from "./tools/notes";
import { WebhookServer } from "./server/webhook-server";
import { getLatestEmailSnippet } from "./tools/gmail-webhook";
import { telegramTool, sendTelegramMessage } from "./tools/telegram";

//telegram bot

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
  polling: true,
});

//openaiclient

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

//tools

const openAITools = [...notesTools, telegramTool].map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

// prompts

const chatSystemPrompt =
  "You are a helpful AI assistant with note-taking capabilities. Use tools when needed and confirm actions.";

let mailSkillPrompt = "";

  //  CHAT HISTORY (ONLY FOR USER CHAT)

const conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
  [{ role: "system", content: chatSystemPrompt }];

//cli

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "\n> ",
});

  //  CORE AGENT FUNCTION

async function chatWithTools(
  userInput: string,
  isolated = false
): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    isolated
      ? [
          { role: "system", content: mailSkillPrompt },
          { role: "user", content: userInput },
        ]
      : [...conversationHistory, { role: "user", content: userInput }];

  const response = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages,
    tools: openAITools,
    tool_choice: "auto",
  });

  const message = response.choices[0].message;

  if (!isolated) {
    conversationHistory.push({ role: "user", content: userInput });
  }

  if (message.tool_calls) {
    if (!isolated) conversationHistory.push(message);

    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;

      const toolName = call.function.name;
      const args = JSON.parse(call.function.arguments);

      console.log(`\n🔧 Using tool: ${toolName}`);

      let result = "";

      if (toolName === "send_telegram_message") {
        result = await sendTelegramMessage(args.message);
      } else {
        result = await executeNotesTool(toolName, args);
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
      messages: isolated ? messages : conversationHistory,
    });

    const finalMessage = followUp.choices[0].message.content || "";

    console.log(`\n${finalMessage}`);

    if (!isolated) {
      conversationHistory.push({
        role: "assistant",
        content: finalMessage,
      });
    }

    return finalMessage;
  }

  const content = message.content || "";

  console.log(`\n${content}`);

  if (!isolated) {
    conversationHistory.push({
      role: "assistant",
      content,
    });
  }

  return content;
}

//email event processor

async function processEmailEvent(email: any) {
  const emailPrompt = `
New email received:

From: ${email.from}
Subject: ${email.subject}
Preview: ${email.snippet}

Decide whether this is PRIORITY, NOTE, or IGNORE.
Use tools when needed.
`;

  await chatWithTools(emailPrompt, true); // isolated run
}




//main

async function main() {
  mailSkillPrompt = await fs.readFile(
    path.join(process.cwd(), "src", "skills", "mail.md"),
    "utf-8"
  );


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

  console.log("➡️ Expose webhook with: ngrok http 3000");


  console.log("🤖 Simple Note-Taking Agent");
  console.log("━".repeat(50));

  rl.prompt();

  rl.on("line", async (input) => {
    const userInput = input.trim();

    if (!userInput) return rl.prompt();

    if (userInput.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    try {
      await chatWithTools(userInput);
    } catch (err: any) {
      console.error("❌ Error:", err.message);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n👋 Goodbye!");
    process.exit(0);
  });
}



bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text) return;

  const response = await chatWithTools(text);
  await bot.sendMessage(msg.chat.id, response);
});


//start

main();
