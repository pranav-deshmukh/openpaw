export interface InboundMessage {
    id: string;
    source: string;
    chatId: string;
    text: string;
    timestamp: number;
    isolated?: boolean;
    agentId?: string;
    isHeartbeat?: boolean;
    /** Override delivery channel — used by scheduler to reply via telegram even though source is "scheduler" */
    replyTo?: string;
    /** Override delivery chatId — used by scheduler to know which chat to send to */
    replyChatId?: string;
}

export interface OutboundMessage {
    id: string;
    target: string;
    chatId: string;
    text: string;
    timestamp: number;
}

export interface ReplyContext {
    source: string;
    chatId: string;
    agentId: string;
    /** The actual channel to deliver to (may differ from source for scheduler jobs) */
    replyTo: string;
    /** The actual chatId to deliver to */
    replyChatId: string;
}

let _currentReplyContext: ReplyContext | null = null;

export function setReplyContext(ctx: ReplyContext | null): void {
    _currentReplyContext = ctx;
}

export function getReplyContext(): ReplyContext | null {
    return _currentReplyContext;
}