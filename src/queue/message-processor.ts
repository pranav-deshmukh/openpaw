/**
 * MessageProcessor — central processing loop for the queue-based architecture.
 *
 * Runs two independent loops:
 *   - Inbound loop:  dequeues messages, resolves the target agent via the
 *                     Router, sets reply context, runs the agent's chat(),
 *                     enqueues the response to the outbound queue.
 *   - Outbound loop: independently polls the outbound queue and delivers
 *                     messages to the correct channel via the registry.
 *
 * The two loops run concurrently but don't depend on each other —
 * outbound delivery happens as soon as a message is enqueued, regardless
 * of whether the inbound loop is busy processing the next message.
 */

import crypto from "crypto";
import { inboundQueue, outboundQueue } from "./message-queue";
import { setReplyContext } from "./message-types";
import { channelRegistry } from "../channel/channel-registry";
import { mdToText } from "../cli/markdown";

import type { AgentRegistry } from "../agents/agent-registry";
import type { Router } from "../agents/router";

export class MessageProcessor {
    private agentRegistry: AgentRegistry;
    private router: Router;
    private running = false;
    private pollIntervalMs: number;

    constructor(agentRegistry: AgentRegistry, router: Router, pollIntervalMs = 100) {
        this.agentRegistry = agentRegistry;
        this.router = router;
        this.pollIntervalMs = pollIntervalMs;
    }

    /** Start both inbound and outbound loops independently. */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.inboundLoop();
        this.outboundLoop();
    }

    /** Stop both loops. */
    stop(): void {
        this.running = false;
    }

    /**
     * Continuously polls the inbound queue for new messages.
     * When a message is found, it is handed off to `processNext()`.
     */
    private async inboundLoop(): Promise<void> {
        while (this.running) {
            if (!inboundQueue.isEmpty) {
                await this.processNext();
            } else {
                await this.sleep(this.pollIntervalMs);
            }
        }
    }

    /** Process the next inbound message. */
    private async processNext(): Promise<void> {
        const msg = inboundQueue.dequeue();
        if (!msg) return;

        // Resolve which agent should handle this message
        const agentId = this.router.resolve(msg);
        const agent = this.agentRegistry.get(agentId);

        if (!agent) {
            console.error(`❌ No agent registered for "${agentId}"`);
            outboundQueue.enqueue({
                id: crypto.randomUUID(),
                target: msg.source,
                chatId: msg.chatId,
                text: `❌ No agent found for "${agentId}"`,
                timestamp: Date.now(),
            });
            return;
        }

        console.log(`\n📨 Processing [${msg.source}] → agent "${agentId}": ${msg.text.substring(0, 60)}...`);

        // Set reply context so tools know where to send replies
        setReplyContext({ source: msg.source, chatId: msg.chatId, agentId });

        try {
            const response = await agent.chat(msg.text, msg.isolated);

            // Enqueue the agent's response back to the originating channel
            if (response && msg.source !== "email") {
                outboundQueue.enqueue({
                    id: crypto.randomUUID(),
                    target: msg.source,
                    chatId: msg.chatId,
                    text: response,
                    timestamp: Date.now(),
                });
            }
        } catch (err: any) {
            console.error(`❌ Processor error [${msg.source}] agent "${agentId}":`, err.message);

            outboundQueue.enqueue({
                id: crypto.randomUUID(),
                target: msg.source,
                chatId: msg.chatId,
                text: `❌ Something went wrong: ${err.message}`,
                timestamp: Date.now(),
            });
        }

        // Clear reply context
        setReplyContext(null);
    }

    /**
     * Continuously polls the outbound queue for pending deliveries.
     * When a message is found, it is handed off to `deliverNext()`.
     */
    private async outboundLoop(): Promise<void> {
        while (this.running) {
            if (!outboundQueue.isEmpty) {
                await this.deliverNext();
            } else {
                await this.sleep(this.pollIntervalMs);
            }
        }
    }

    /**
     * Deliver the next outbound message.
     * Routes to the correct channel via the ChannelRegistry,
     * or prints to console for CLI targets.
     */
    private async deliverNext(): Promise<void> {
        const msg = outboundQueue.dequeue();
        if (!msg) {
            console.log("\n📨 Empty outbound message.");
            return;
        }

        // CLI output → convert markdown to plain text
        if (msg.target === "cli") {
            console.log(`\n${mdToText(msg.text)}`);
            return;
        }

        // Look up the channel and deliver
        const channel = channelRegistry.get(msg.target);

        if (!channel) {
            console.error(`❌ No channel registered for "${msg.target}"`);
            return;
        }

        try {
            await channel.sendToChat(msg.chatId, msg.text);
        } catch (err: any) {
            console.error(`❌ Failed to deliver to ${msg.target}:`, err.message);
        }
    }

    /**
     * Pause execution for the given number of milliseconds.
     * Used to avoid busy-looping when queues are empty.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
