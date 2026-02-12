import dotenv from "dotenv";
import readline from "readline";
import OpenAI from "openai";
import { notesTools, executeNotesTool } from "./tools/notes";
import { WebhookServer } from "./server/webhook-server";
import { getLatestEmailSnippet } from "./tools/gmail-webhook";

dotenv.config();

// if (!process.env.OPENAI_API_KEY) {
//   console.error("❌ Error: OPENAI_API_KEY not found in .env file");
//   process.exit(1);
// }

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// Convert Claude-style tools → OpenAI tool format
const openAITools = notesTools.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

const conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
  [
    {
      role: "system",
      content:
        "You are a helpful AI assistant with note-taking capabilities. Use tools when needed and confirm actions.",
    },
  ];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "\n> ",
});

async function chatWithTools(userInput: string) {
  conversationHistory.push({ role: "user", content: userInput });

  const response = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: conversationHistory,
    tools: openAITools,
    tool_choice: "auto",
  });

  const message = response.choices[0].message;

  // If model wants to call tools
  if (message.tool_calls) {
    conversationHistory.push(message);
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue; // Type guard

      const toolName = call.function.name;
      const args = JSON.parse(call.function.arguments);

      console.log(`\n🔧 Using tool: ${toolName}`);

      try {
        const result = await executeNotesTool(toolName, args);
        console.log(result);

        conversationHistory.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      } catch (error: any) {
        conversationHistory.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Error: ${error.message}`,
        });
      }
    }

    // Ask model for final response after tool execution
    const followUp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversationHistory,
    });

    const finalMessage = followUp.choices[0].message.content;
    console.log(`\n${finalMessage}`);
    conversationHistory.push({ role: "assistant", content: finalMessage });
  } else {
    // No tool used, normal response
    console.log(`\n${message.content}`);
    conversationHistory.push({ role: "assistant", content: message.content });
  }
}

async function main() {
  // Start webhook server
  const webhookServer = new WebhookServer(3000);

  webhookServer.onWebhook("gmail", async (data) => {
    console.log("\n📧 New Gmail notification received!");

    const email = await getLatestEmailSnippet(data.historyId);

    if (email) {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`📬 New Email!`);
      console.log(`From: ${email.from}`);
      console.log(`Subject: ${email.subject}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    } else {
      console.log("No new email details found.");
    }
  });

  webhookServer.start();

  console.log("➡️ Expose webhook with: ngrok http 3000");

  console.log("🤖 Simple Note-Taking Agent (OpenAI)");
  console.log("━".repeat(50));
  console.log("Try things like:");
  console.log("  Remember: dentist appointment tomorrow 3pm");
  console.log("  Show my notes");
  console.log("  Search for dentist");
  console.log("  exit");
  console.log("━".repeat(50));

  rl.prompt();

  rl.on("line", async (input) => {
    const userInput = input.trim();

    if (!userInput) return rl.prompt();

    if (userInput.toLowerCase() === "exit") {
      console.log("👋 Goodbye!");
      rl.close();
      return;
    }

    try {
      await chatWithTools(userInput);
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n👋 Goodbye!");
    process.exit(0);
  });
}

main();
