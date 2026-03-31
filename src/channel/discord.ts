import { Client, GatewayIntentBits, TextChannel, Message } from "discord.js";
import { MessageChannel } from "./base-channel";

/**
 * DiscordChannel — Discord implementation of `MessageChannel`.
 *
 * Follows the same pattern as TelegramChannel:
 *   - Incoming message handling via `onMessage()` callback
 *   - Outgoing notifications via `sendMessage()` (implements `MessageChannel`)
 *   - Reply to a specific channel via `sendToChat()`
 */

type MessageHandler = (text: string, channelId: string) => Promise<void>;

export class DiscordChannel implements MessageChannel {
    readonly name = "Discord";

    private client: Client;
    private channelId: string;

    constructor() {
        const token = process.env.DISCORD_BOT_TOKEN;
        if (!token) {
            throw new Error("DISCORD_BOT_TOKEN is not set in environment.");
        }

        this.channelId = process.env.DISCORD_CHANNEL_ID || "";

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        this.client.once("ready", () => {
            console.log(`✅ Discord bot logged in as ${this.client.user?.tag}`);
        });

        this.client.login(token).catch((err) => {
            console.error("❌ Failed to login Discord bot:", err.message);
        });
    }

    /**
     * Register a handler for incoming Discord messages.
     * The handler receives the message text and the channel ID.
     */
    onMessage(handler: MessageHandler): void {
        this.client.on("messageCreate", async (msg: Message) => {
            // Ignore bot messages (including our own)
            if (msg.author.bot) return;

            // Only process messages from the configured channel
            if (this.channelId && msg.channelId !== this.channelId) return;

            const text = msg.content;
            if (!text) return;

            try {
                await handler(text, msg.channelId);
            } catch (err: any) {
                console.error("❌ Discord handler error:", err.message);
            }
        });
    }

    /**
     * Send a message to the default channel (implements `MessageChannel`).
     */
    async sendMessage(message: string): Promise<string> {
        if (!this.channelId) {
            return "❌ No DISCORD_CHANNEL_ID set.";
        }

        return this.sendToChat(this.channelId, message);
    }

    /**
     * Send a message to a specific channel by ID (implements `MessageChannel`).
     * Used by the outbound message processor.
     */
    async sendToChat(chatId: string, message: string): Promise<string> {
        try {
            const channel = await this.client.channels.fetch(chatId);
            if (!channel || !channel.isTextBased()) {
                return `❌ Channel "${chatId}" not found or is not a text channel.`;
            }

            const chunks = splitMessage(mdToDiscord(message));
            for (const chunk of chunks) {
                await (channel as TextChannel).send(chunk);
            }
            return "Sent.";
        } catch (err: any) {
            console.error("❌ Discord sendToChat error:", err);
            return `❌ Failed to send Discord message: ${err.message}`;
        }
    }
}

/** Discord's maximum message length. */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Split text into chunks that fit within Discord's message limit.
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
 * Convert standard markdown to Discord-friendly markdown.
 * Discord natively supports most markdown, so this is a light pass:
 *   - Strips image tags (Discord can't render inline images from markdown)
 *   - Keeps everything else as-is
 */
function mdToDiscord(md: string): string {
    // Images: ![alt](url) → alt
    let result = md.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

    return result;
}
