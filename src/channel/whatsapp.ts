import { Client, LocalAuth, Message as WAMessage } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { MessageChannel } from "./base-channel";

type MessageHandler = (text: string, chatId: string) => Promise<void>;

export class WhatsAppChannel implements MessageChannel {
    readonly name = "WhatsApp";
    private client: Client;
    private allowedGroupId: string;
    private handler?: MessageHandler;

    constructor() {
        this.allowedGroupId = process.env.WHATSAPP_ALLOWED_GROUP_ID || "";
        
        if (!this.allowedGroupId) {
            console.warn("⚠️ WHATSAPP_ALLOWED_GROUP_ID is not set. WhatsApp channel will not process any messages.");
        }

        this.client = new Client({
            // Use local auth to persist session inside the memory directory
            authStrategy: new LocalAuth({ dataPath: "./openpaw-memory/whatsapp-auth" }),
            // Required for windows/puppeteer in some setups, but defaults are usually fine
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                timeout: 120000,          // 2 minutes for general puppeteer timeout
                protocolTimeout: 120000   // 2 minutes for CDP protocol timeout
            }
        });

        this.setupListeners();
    }

    private setupListeners(): void {
        this.client.on("qr", (qr) => {
            console.log("📱 WhatsApp Authentication QR Code (Scan with Linked Devices):");
            qrcode.generate(qr, { small: true });
        });

        this.client.on("ready", () => {
            console.log(`✅ WhatsApp Client is ready! Listening for group ID: "${this.allowedGroupId}"`);
            console.log(`\nℹ️  To find a group ID, simply send a message in that group. It will be logged here.\n`);
        });

        this.client.on("message_create", async (msg: WAMessage) => {
            if (msg.from === "status@broadcast") return;
            
            // Prevent infinite loop by checking if the message has our bot prefix
            if (msg.body && msg.body.startsWith("Pepprr:")) {
                return;
            }

            try {
                const chat = await msg.getChat();
                
                // Log incoming group messages to help the user discover IDs easily
                if (chat.isGroup) {
                    console.log(`[WhatsApp] 📨 Received message in group: "${chat.name}" -> ID: ${chat.id._serialized}`);
                }

                if (!this.allowedGroupId) return;

                // Only respond if it's a group and matches the allowed ID
                if (chat.isGroup && chat.id._serialized === this.allowedGroupId) {
                    if (this.handler && msg.body) {
                        // Pass the group chat ID, not msg.from (which is the user's own number on message_create)
                        await this.handler(msg.body, chat.id._serialized);
                    }
                }
            } catch (err: any) {
                console.error("❌ WhatsApp message error:", err.message);
            }
        });
    }

    /**
     * Start the WhatsApp client connection process.
     */
    public initialize(): void {
        this.client.initialize().catch((err) => {
            console.error("❌ Failed to initialize WhatsApp client:", err);
        });
    }

    /**
     * Register a handler for incoming WhatsApp messages.
     */
    onMessage(handler: MessageHandler): void {
        this.handler = handler;
    }

    /**
     * Send a message to the configured default group.
     */
    async sendMessage(message: string): Promise<string> {
        if (!this.allowedGroupId) {
            return "❌ No allowed WhatsApp group configured.";
        }

        try {
            const chunks = splitMessage(message);
            for (const chunk of chunks) {
                const waText = "Pepprr:\n" + mdToWhatsApp(chunk);
                await this.client.sendMessage(this.allowedGroupId, waText);
            }
            return "Notification sent via WhatsApp.";
        } catch (err: any) {
            console.error("❌ WhatsApp sendMessage error:", err);
            return `❌ Failed to send WhatsApp message: ${err.message}`;
        }
    }

    /**
     * Send a message to a specific chat by ID.
     */
    async sendToChat(chatId: string, message: string): Promise<string> {
        try {
            const chunks = splitMessage(message);
            for (const chunk of chunks) {
                const waText = "Pepprr:\n" + mdToWhatsApp(chunk);
                await this.client.sendMessage(chatId, waText);
            }
            return "Sent.";
        } catch (err: any) {
            console.error("❌ WhatsApp sendToChat error:", err);
            return `❌ Failed to send WhatsApp message: ${err.message}`;
        }
    }
}

/**
 * Basic conversion from standard Markdown to WhatsApp formatting.
 * WhatsApp uses:
 * - *bold*
 * - _italic_
 * - ~strikethrough~
 * - ```monospace```
 */
const MAX_MESSAGE_LENGTH = 4096;

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
 * Robust conversion from standard Markdown to WhatsApp formatting.
 * WhatsApp uses:
 * - *bold*
 * - _italic_
 * - ~strikethrough~
 * - ```monospace```
 */
function mdToWhatsApp(md: string): string {
    let remaining = md;
    const placeholders: string[] = [];

    // Code blocks: ```lang\ncode``` → keep as-is without language tags
    remaining = remaining.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang: string, code: string) => {
        const idx = placeholders.length;
        placeholders.push(`\`\`\`\n${code}\n\`\`\``);
        return `\x00PH${idx}\x00`;
    });

    // Inline code: `code` → format as WhatsApp monospace ```code```
    remaining = remaining.replace(/`([^`]+)`/g, (_match, code: string) => {
        const idx = placeholders.length;
        placeholders.push(`\`\`\`${code}\`\`\``);
        return `\x00PH${idx}\x00`;
    });

    // Images: ![alt](url) -> alt (url)
    remaining = remaining.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

    // Links: [text](url) → text (url)
    remaining = remaining.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
        const idx = placeholders.length;
        placeholders.push(`${text} (${url})`);
        return `\x00PH${idx}\x00`;
    });

    // Bold + italic: ***text*** → *_text_*
    remaining = remaining.replace(/\*{3}(.+?)\*{3}/g, '*_$1_*');
    // Bold: **text** → *text*
    remaining = remaining.replace(/\*{2}(.+?)\*{2}/g, '*$1*');
    // Italic: *text* → _text_
    remaining = remaining.replace(/\*(.+?)\*/g, '_$1_');
    // Underscore italic: _text_ → _text_
    remaining = remaining.replace(/(?<!\w)_(.+?)_(?!\w)/g, '_$1_');
    // Strikethrough: ~~text~~ → ~text~
    remaining = remaining.replace(/~~(.+?)~~/g, '~$1~');

    // Headers: strip # prefix, make bold
    remaining = remaining.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

    // Horizontal rules -> separator
    remaining = remaining.replace(/^[-*_]{3,}\s*$/gm, "──────────────");

    // Unordered lists: - item or * item → • item
    remaining = remaining.replace(/^(\s*)[-*]\s+/gm, "$1• ");

    // Blockquotes: > text → ▎ text (simple vertical bar lookalike)
    remaining = remaining.replace(/^>\s?(.*)$/gm, "▎ $1");

    // Restore placeholders
    const parts = remaining.split(/(\x00PH\d+\x00)/);
    const result = parts.map((part) => {
        const phMatch = part.match(/^\x00PH(\d+)\x00$/);
        if (phMatch) {
            return placeholders[parseInt(phMatch[1], 10)];
        }
        return part;
    });

    return result.join("");
}
