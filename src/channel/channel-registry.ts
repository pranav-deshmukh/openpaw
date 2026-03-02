/**
 * ChannelRegistry — maps channel names to MessageChannel instances.
 *
 * Used by the outbound message processor to look up the correct channel
 * when delivering a queued message.
 *
 * Usage:
 *   channelRegistry.register("telegram", telegramChannel);
 *   const ch = channelRegistry.get("telegram");
 *   await ch.sendToChat(chatId, text);
 */

import { MessageChannel } from "./base-channel";

class ChannelRegistry {
    private channels = new Map<string, MessageChannel>();

    /** Register a channel under a unique name. */
    register(name: string, channel: MessageChannel): void {
        if (this.channels.has(name)) {
            throw new Error(`Channel "${name}" is already registered.`);
        }
        this.channels.set(name, channel);
    }

    /** Look up a channel by name. Returns `undefined` if not found. */
    get(name: string): MessageChannel | undefined {
        return this.channels.get(name);
    }

    /** Check whether a channel name is registered. */
    has(name: string): boolean {
        return this.channels.has(name);
    }

    /** Return all registered channel names. */
    list(): string[] {
        return Array.from(this.channels.keys());
    }
}

/** Singleton channel registry. */
export const channelRegistry = new ChannelRegistry();
