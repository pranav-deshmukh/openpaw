import { BaseTool, ToolParametersSchema } from "./base-tool";
import { outboundQueue } from "../queue/message-queue";
import { getReplyContext } from "../queue/message-types";
import crypto from "crypto";

export class SendMessageTool extends BaseTool {
    readonly name = "send_message";

    readonly description =
        "Send a message to the user via Telegram. " +
        "Use this for reminders, alerts, and notifications — especially when triggered by scheduled jobs. " +
        "When a scheduler job fires, ALWAYS use this tool to deliver the message to the user. Do NOT ask questions.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            message: {
                type: "string",
                description: "The message text to send to the user",
            },
        },
        required: ["message"],
    };

    async execute(args: Record<string, unknown>): Promise<string> {
        const message = args.message as string;
        const ctx = getReplyContext();

        if (!ctx) {
            return "❌ No active reply context — cannot determine where to send the message.";
        }

        // Use replyTo/replyChatId if set (e.g. scheduler jobs), otherwise fall back to source/chatId
        const target = ctx.replyTo || ctx.source;
        const chatId = ctx.replyChatId || ctx.chatId;

        outboundQueue.enqueue({
            id: crypto.randomUUID(),
            target,
            chatId,
            text: message,
            timestamp: Date.now(),
        });

        return `✅ Message sent via ${target}.`;
    }
}