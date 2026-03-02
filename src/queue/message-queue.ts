/**
 * MessageQueue — generic FIFO queue.
 *
 * Two singleton instances are exported:
 *   - `inboundQueue`  — fed by channels (Telegram, CLI, email)
 *   - `outboundQueue` — drained by the processor to deliver replies
 *
 * Each consumer imports only the queue it needs (principle of least privilege).
 */

import { InboundMessage, OutboundMessage } from "./message-types";

class MessageQueue<T> {
    private queue: T[] = [];

    /** Add an item to the back of the queue. */
    enqueue(item: T): void {
        this.queue.push(item);
    }

    /** Remove and return the item at the front, or `undefined` if empty. */
    dequeue(): T | undefined {
        return this.queue.shift();
    }

    /** Peek at the front item without removing it. */
    peek(): T | undefined {
        return this.queue[0];
    }

    /** Number of items currently in the queue. */
    get length(): number {
        return this.queue.length;
    }

    /** Whether the queue is empty. */
    get isEmpty(): boolean {
        return this.queue.length === 0;
    }
}

/* ── Singleton instances ──────────────────────────── */

export const inboundQueue = new MessageQueue<InboundMessage>();
export const outboundQueue = new MessageQueue<OutboundMessage>();
