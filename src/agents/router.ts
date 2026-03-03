/**
 * Router — determines which agent handles each incoming message.
 *
 * Rules are checked in order; the first matching rule wins.
 * If no rule matches, falls back to the configured default agent.
 */

import type { InboundMessage } from "../queue/message-types";

export interface RouterRule {
    /** Source channel to match ("telegram" | "email" | "cli" | "*" for any). */
    source: string;

    /** Optional: specific chat ID to match. Omit to match any chat. */
    chatId?: string;

    /** The agent ID to route matching messages to. */
    agentId: string;
}

export class Router {
    private rules: RouterRule[];
    private defaultAgentId: string;

    constructor(rules: RouterRule[], defaultAgentId: string) {
        this.rules = rules;
        this.defaultAgentId = defaultAgentId;
    }

    /**
     * Resolve which agent ID should handle the given message.
     *
     * If the message already has an `agentId` set (e.g. from delegation),
     * that takes priority. Otherwise, rules are checked in order.
     */
    resolve(msg: InboundMessage): string {
        // Explicit routing (e.g. from delegate_to_agent or agent-to-agent comms)
        if (msg.agentId) {
            return msg.agentId;
        }

        for (const rule of this.rules) {
            // Source must match exactly or be wildcard
            if (rule.source !== "*" && rule.source !== msg.source) {
                continue;
            }

            // If rule specifies a chatId, it must match
            if (rule.chatId !== undefined && rule.chatId !== msg.chatId) {
                continue;
            }

            return rule.agentId;
        }

        return this.defaultAgentId;
    }
}
