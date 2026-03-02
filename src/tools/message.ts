import { BaseTool, ToolParametersSchema } from "./base-tool";
import { outboundQueue } from "../queue/message-queue";
import { getReplyContext } from "../queue/message-types";
import crypto from "crypto";

/**
 * SendMessageTool — stateless, queue-based tool for the LLM to send messages.
 *
 * Instead of holding channel references, it reads the current reply context
 * (set by the MessageProcessor) and enqueues an OutboundMessage.
 * The processor then delivers it to the correct channel.
 *
 * The LLM only needs to provide `{ message: "..." }` — routing is automatic.
 *
 * Usage:
 *   const tool = new SendMessageTool();   // no args needed
 *   registry.register(tool);
 */
export class SendMessageTool extends BaseTool {
    readonly name = "send_message";

    readonly description =
        "Send a message to notify the user through the current channel (e.g. Telegram, WhatsApp). Use this for important alerts, reminders, or when the user asks to be notified.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            message: {
                type: "string",
                description: "The message text to send",
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

        outboundQueue.enqueue({
            id: crypto.randomUUID(),
            target: ctx.source,
            chatId: ctx.chatId,
            text: message,
            timestamp: Date.now(),
        });

        return `✅ Message queued for delivery via ${ctx.source}.`;
    }
}
