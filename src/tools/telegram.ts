import TelegramBot from "node-telegram-bot-api";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
  polling: false,
});

export const telegramTool = {
  name: "send_telegram_message",
  description: "Send a Telegram message to notify the user about important events.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },
};

export async function sendTelegramMessage(message: string) {
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  await bot.sendMessage(chatId, message);
  return "Telegram notification sent.";
}
