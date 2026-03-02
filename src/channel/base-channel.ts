/**
 * MessageChannel — interface for any messaging channel (Telegram, WhatsApp, etc.).
 *
 * Implement this interface to add a new channel:
 *   1. Create a class that implements `MessageChannel`
 *   2. Pass it to `SendMessageTool` so the LLM can send messages through it
 *
 * The `name` property is used in logs and tool responses to identify
 * which channel delivered the message.
 */
export interface MessageChannel {
    /** Human-readable channel name (e.g. "Telegram", "WhatsApp"). */
    readonly name: string;

    /** Send a message to the default chat. Returns a status string. */
    sendMessage(message: string): Promise<string>;

    /** Send a message to a specific chat/user by ID. Returns a status string. */
    sendToChat(chatId: string, message: string): Promise<string>;
}
