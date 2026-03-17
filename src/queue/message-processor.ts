/**
 * MessageProcessor — central processing loop for the queue-based architecture.
 */

import crypto from "crypto";
import { inboundQueue, outboundQueue } from "./message-queue";
import { setReplyContext } from "./message-types";
import { channelRegistry } from "../channel/channel-registry";
import { mdToText } from "../cli/markdown";
import { isHeartbeatOk } from "../scheduler/heartbeat";

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

    start(): void {
        if (this.running) return;
        this.running = true;
        this.inboundLoop();
        this.outboundLoop();
    }

    stop(): void {
        this.running = false;
    }

    private async inboundLoop(): Promise<void> {
        while (this.running) {
            if (!inboundQueue.isEmpty) {
                await this.processNext();
            } else {
                await this.sleep(this.pollIntervalMs);
            }
        }
    }

    private async processNext(): Promise<void> {
        const msg = inboundQueue.dequeue();
        if (!msg) return;

        const agentId = this.router.resolve(msg);
        const agent = this.agentRegistry.get(agentId);

        // Compute real delivery target upfront — used in both success and error paths
        const replyTo = msg.replyTo ?? (msg.source === "scheduler" || msg.source === "email" ? "telegram" : msg.source);
        const replyChatId = msg.replyChatId ?? (msg.source === "scheduler" || msg.source === "email"
            ? (process.env.TELEGRAM_CHAT_ID ?? msg.chatId)
            : msg.chatId);

        if (!agent) {
            console.error(`❌ No agent registered for "${agentId}"`);
            if (replyTo !== "scheduler" && replyTo !== "email") {
                outboundQueue.enqueue({
                    id: crypto.randomUUID(),
                    target: replyTo,
                    chatId: replyChatId,
                    text: `❌ No agent found for "${agentId}"`,
                    timestamp: Date.now(),
                });
            }
            return;
        }

        const preview = msg.text ? msg.text.substring(0, 60) : "(no message)";
        console.log(`\n📨 Processing [${msg.source}] → agent "${agentId}": ${preview}...`);

        setReplyContext({ source: msg.source, chatId: msg.chatId, agentId, replyTo, replyChatId });

        try {
            const response = await agent.chat(msg.text ?? "[No message provided]", msg.isolated);

            // Heartbeat: silent drop if nothing to report
            if (msg.isHeartbeat && isHeartbeatOk(response)) {
                console.log(`💓 [${agentId}] Heartbeat OK — nothing to report.`);
                setReplyContext(null);
                return;
            }

            // Scheduler/email: agent delivers via send_message tool, don't auto-enqueue response
            if (response && msg.source !== "email" && msg.source !== "scheduler") {
                outboundQueue.enqueue({
                    id: crypto.randomUUID(),
                    target: replyTo,
                    chatId: replyChatId,
                    text: response,
                    timestamp: Date.now(),
                });
            }
        } catch (err: any) {
            console.error(`❌ Processor error [${msg.source}] agent "${agentId}":`, err.message);

            // Only deliver error to real channels — never to "scheduler" or "email"
            if (replyTo !== "scheduler" && replyTo !== "email") {
                outboundQueue.enqueue({
                    id: crypto.randomUUID(),
                    target: replyTo,
                    chatId: replyChatId,
                    text: `❌ Something went wrong: ${err.message}`,
                    timestamp: Date.now(),
                });
            }
        }

        setReplyContext(null);
    }

    private async outboundLoop(): Promise<void> {
        while (this.running) {
            if (!outboundQueue.isEmpty) {
                await this.deliverNext();
            } else {
                await this.sleep(this.pollIntervalMs);
            }
        }
    }

    private async deliverNext(): Promise<void> {
        const msg = outboundQueue.dequeue();
        if (!msg) return;

        if (msg.target === "cli") {
            console.log(`\n${mdToText(msg.text)}`);
            return;
        }

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

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}