/**
 * Message types and reply context for the queue-based message architecture.
 *
 * InboundMessage  — arrives from any channel (Telegram, CLI, email)
 * OutboundMessage — routed from the agent back to a specific channel + chat
 * ReplyContext    — set by the processor before each agent invocation so
 *                   tools like SendMessageTool know where to route replies
 */

export interface InboundMessage {
    /** Unique message ID. */
    id: string;

    /** Originating channel (e.g. "telegram", "cli", "email"). */
    source: string;

    /** Chat / user ID within the source channel. */
    chatId: string;

    /** The user's message text. */
    text: string;

    /** Unix timestamp in milliseconds. */
    timestamp: number;

    /** If true, the message should be processed in isolated mode (no history). */
    isolated?: boolean;
}

export interface OutboundMessage {
    /** Unique message ID. */
    id: string;

    /** Target channel (e.g. "telegram", "cli"). */
    target: string;

    /** Chat / user ID within the target channel. */
    chatId: string;

    /** The message text to deliver. */
    text: string;

    /** Unix timestamp in milliseconds. */
    timestamp: number;
}

export interface ReplyContext {
    /** Channel the current message came from. */
    source: string;

    /** Chat ID to reply to. */
    chatId: string;
}

/**
 * The currently active reply context.
 *
 * Set by the MessageProcessor before each `chatWithTools()` invocation.
 * Read by SendMessageTool to know where to route outbound messages.
 * Safe because processing is sequential — only one message at a time.
 */
let _currentReplyContext: ReplyContext | null = null;

export function setReplyContext(ctx: ReplyContext | null): void {
    _currentReplyContext = ctx;
}

export function getReplyContext(): ReplyContext | null {
    return _currentReplyContext;
}
