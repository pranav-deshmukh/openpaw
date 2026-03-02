import TelegramBot from "node-telegram-bot-api";
import { MessageChannel } from "./base-channel";

/**
 * TelegramChannel — Telegram implementation of `MessageChannel`.
 *
 * Provides a single bot instance for both receiving and sending messages:
 *   - Incoming message handling via `onMessage()` callback
 *   - Outgoing notifications via `sendMessage()` (implements `MessageChannel`)
 *   - Reply to a specific chat via `reply()`
 */

type MessageHandler = (text: string, chatId: number) => Promise<void>;

export class TelegramChannel implements MessageChannel {
    readonly name = "Telegram";

    private bot: TelegramBot;
    private chatId: string;

    constructor() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            throw new Error("TELEGRAM_BOT_TOKEN is not set in environment.");
        }

        this.chatId = process.env.TELEGRAM_CHAT_ID || "";
        this.bot = new TelegramBot(token, { polling: true });
    }

    /**
     * Register a handler for incoming Telegram messages.
     * The handler receives the message text and the chat ID.
     */
    onMessage(handler: MessageHandler): void {
        this.bot.on("message", async (msg) => {
            const text = msg.text;
            if (!text) return;

            try {
                await handler(text, msg.chat.id);
            } catch (err: any) {
                console.error("❌ Telegram handler error:", err.message);
            }
        });
    }

    /**
     * Send a message to the default chat (implements `MessageChannel`).
     */
    async sendMessage(message: string): Promise<string> {
        if (!this.chatId) {
            return "❌ No TELEGRAM_CHAT_ID set.";
        }

        const chunks = splitMessage(mdToTelegram(message));
        for (const chunk of chunks) {
            await this.bot.sendMessage(this.chatId, chunk, { parse_mode: "MarkdownV2" });
        }
        return "Notification sent.";
    }

    /**
     * Send a message to a specific chat by ID (implements `MessageChannel`).
     * Used by the outbound message processor.
     */
    async sendToChat(chatId: string, message: string): Promise<string> {
        const chunks = splitMessage(mdToTelegram(message));
        for (const chunk of chunks) {
            await this.bot.sendMessage(chatId, chunk, { parse_mode: "MarkdownV2" });
        }
        return "Sent.";
    }
}

/** Telegram's maximum message length. */
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Split text into chunks that fit within Telegram's message limit.
 * Splits at paragraph boundaries (double newline) first, then at
 * single newlines, and as a last resort at the character limit.
 */
function splitMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        let splitAt = -1;

        // Try splitting at a paragraph break (double newline)
        const paragraphBreak = remaining.lastIndexOf("\n\n", maxLength);
        if (paragraphBreak > 0) {
            splitAt = paragraphBreak;
        }

        // Fall back to a single newline
        if (splitAt === -1) {
            const lineBreak = remaining.lastIndexOf("\n", maxLength);
            if (lineBreak > 0) {
                splitAt = lineBreak;
            }
        }

        // Last resort: hard cut at the limit
        if (splitAt === -1) {
            splitAt = maxLength;
        }

        chunks.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt).replace(/^\n+/, "");
    }

    return chunks;
}

/**
 * Escape a string for Telegram MarkdownV2.
 */
function escapeMarkdownV2(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Convert standard markdown to Telegram MarkdownV2 format.
 */
function mdToTelegram(md: string): string {
    let remaining = md;

    const placeholders: string[] = [];

    // Code blocks: ```lang\ncode``` → keep as-is in Telegram format
    remaining = remaining.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
        const idx = placeholders.length;
        placeholders.push(`\`\`\`${lang}\n${code}\`\`\``);
        return `\x00PH${idx}\x00`;
    });

    // Inline code: `code` → keep as-is
    remaining = remaining.replace(/`([^`]+)`/g, (_match, code: string) => {
        const idx = placeholders.length;
        placeholders.push(`\`${code}\``);
        return `\x00PH${idx}\x00`;
    });

    // Links: [text](url) → keep, but escape text
    remaining = remaining.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
        const idx = placeholders.length;
        placeholders.push(`[${escapeMarkdownV2(text)}](${url})`);
        return `\x00PH${idx}\x00`;
    });

    // Bold + italic: ***text*** → *_text_*
    remaining = remaining.replace(/\*{3}(.+?)\*{3}/g, (_match, text: string) => {
        const idx = placeholders.length;
        placeholders.push(`*_${escapeMarkdownV2(text)}_*`);
        return `\x00PH${idx}\x00`;
    });

    // Bold: **text** → *text*
    remaining = remaining.replace(/\*{2}(.+?)\*{2}/g, (_match, text: string) => {
        const idx = placeholders.length;
        placeholders.push(`*${escapeMarkdownV2(text)}*`);
        return `\x00PH${idx}\x00`;
    });

    // Italic: *text* → _text_
    remaining = remaining.replace(/\*(.+?)\*/g, (_match, text: string) => {
        const idx = placeholders.length;
        placeholders.push(`_${escapeMarkdownV2(text)}_`);
        return `\x00PH${idx}\x00`;
    });

    // Underscore italic: _text_ → _text_
    remaining = remaining.replace(/(?<!\w)_(.+?)_(?!\w)/g, (_match, text: string) => {
        const idx = placeholders.length;
        placeholders.push(`_${escapeMarkdownV2(text)}_`);
        return `\x00PH${idx}\x00`;
    });

    // Strikethrough: ~~text~~ → ~text~
    remaining = remaining.replace(/~~(.+?)~~/g, (_match, text: string) => {
        const idx = placeholders.length;
        placeholders.push(`~${escapeMarkdownV2(text)}~`);
        return `\x00PH${idx}\x00`;
    });

    // Headers: strip # prefix, make bold
    remaining = remaining.replace(/^#{1,6}\s+(.+)$/gm, (_match, heading: string) => {
        const idx = placeholders.length;
        placeholders.push(`*${escapeMarkdownV2(heading.trim())}*`);
        return `\x00PH${idx}\x00`;
    });

    // Horizontal rules
    remaining = remaining.replace(/^[-*_]{3,}\s*$/gm, () => {
        const idx = placeholders.length;
        placeholders.push("─".repeat(20));
        return `\x00PH${idx}\x00`;
    });

    // Unordered lists: - item or * item → • item
    remaining = remaining.replace(/^(\s*)[-*]\s+/gm, "$1• ");

    // Blockquotes: > text → ▎ text
    remaining = remaining.replace(/^>\s?(.*)$/gm, "▎ $1");

    // Images: ![alt](url) → alt
    remaining = remaining.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

    // Escape everything that's NOT a placeholder
    const parts = remaining.split(/(\x00PH\d+\x00)/);
    const result = parts.map((part) => {
        const phMatch = part.match(/^\x00PH(\d+)\x00$/);
        if (phMatch) {
            return placeholders[parseInt(phMatch[1], 10)];
        }
        return escapeMarkdownV2(part);
    });

    return result.join("");
}