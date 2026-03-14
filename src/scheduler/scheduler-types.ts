/**
 * Scheduler Types — shared interfaces for the OpenPaw scheduler system.
 */

export type ScheduleKind =
    | { kind: "cron"; expr: string }        // "0 7 * * *" — standard 5-field cron
    | { kind: "every"; intervalMs: number }  // repeat every N milliseconds
    | { kind: "at"; isoTime: string };    // one-shot ISO 8601 datetime

export interface ScheduledJob {
    /** Unique job ID (uuid). */
    id: string;

    /** Human-readable label shown in /scheduler. */
    name: string;

    /** Schedule definition. */
    schedule: ScheduleKind;

    /** Which agent handles this job. */
    agentId: string;

    /** Text sent to the agent when the job fires. */
    message: string;

    /** If true, agent runs without conversation history. Default: true. */
    isolated: boolean;

    /**
     * IANA timezone string for display purposes (e.g. "Asia/Kolkata").
     * All internal timestamps are UTC — this is only used when showing times to the user.
     */
    timezone?: string;

    /** Whether the job is active. */
    enabled: boolean;

    /** If true, the job is deleted after it fires once (used for schedule_at). */
    deleteAfterRun?: boolean;

    /** Unix ms timestamp of the last time this job fired. */
    lastRunAt?: number;

    /** Unix ms timestamp of the next scheduled fire. Pre-computed and persisted. */
    nextRunAt: number;

    /** Unix ms timestamp of when this job was created. */
    createdAt: number;

    /**
     * If true, the agent response is checked for HEARTBEAT_OK.
     * If the agent replies HEARTBEAT_OK, output is silently dropped.
     */
    isHeartbeat?: boolean;
}