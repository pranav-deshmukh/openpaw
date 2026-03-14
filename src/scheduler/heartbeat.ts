/**
 * Heartbeat — per-agent recurring check-in system.
 *
 * Each agent with heartbeat enabled gets a recurring scheduler job.
 * If the agent replies HEARTBEAT_OK (nothing to report), output is dropped.
 * If the agent has something to say, it uses send_message to notify the user.
 */

import type { Scheduler } from "./scheduler";

export interface HeartbeatConfig {
    agentId: string;
    intervalMs: number;
    activeHoursStart?: number; // 0-23, only fire during these hours (inclusive)
    activeHoursEnd?: number;   // 0-23
    timezone?: string;
}

/** The message sent to the agent on each heartbeat tick. */
export const HEARTBEAT_MESSAGE = `[HEARTBEAT] Time to check in.

Review the items below and act if anything needs attention.
If nothing requires action, reply with exactly: HEARTBEAT_OK

Checklist:
- Are there any tasks, reminders, or scheduled events due soon?
- Is there anything important the user should know right now?
- Any pending follow-ups from previous conversations?

Rules:
- If everything is fine: reply HEARTBEAT_OK (nothing else)
- If something needs attention: use send_message to notify the user, then describe what you did
- Do NOT reply HEARTBEAT_OK if you send a notification`;

/**
 * Register heartbeat jobs in the scheduler for all configured agents.
 * Safe to call on every startup — skips if a heartbeat job for this agent
 * already exists (checked by name convention).
 */
export async function initHeartbeats(
    configs: HeartbeatConfig[],
    schedulerInstance: Scheduler
): Promise<void> {
    for (const config of configs) {
        const jobName = `heartbeat:${config.agentId}`;

        // Check if already registered (survives restarts from scheduler.json)
        const existing = schedulerInstance
            .listJobs()
            .find((j) => j.name === jobName && j.isHeartbeat);

        if (existing) {
            console.log(`💓 Heartbeat for "${config.agentId}" already loaded from disk.`);
            continue;
        }

        await schedulerInstance.addJob({
            name: jobName,
            schedule: { kind: "every", intervalMs: config.intervalMs },
            agentId: config.agentId,
            message: buildHeartbeatMessage(config),
            isolated: false, // heartbeat runs in main session context
            timezone: config.timezone,
            enabled: true,
            deleteAfterRun: false,
            isHeartbeat: true,
        });

        console.log(
            `💓 Heartbeat registered for agent "${config.agentId}" (every ${config.intervalMs / 60000}min)`
        );
    }
}

/** Build the heartbeat message, injecting active hours if configured. */
function buildHeartbeatMessage(config: HeartbeatConfig): string {
    let message = HEARTBEAT_MESSAGE;

    if (config.activeHoursStart !== undefined && config.activeHoursEnd !== undefined) {
        message += `\n\nNote: Only act if current time is between ${config.activeHoursStart}:00 and ${config.activeHoursEnd}:00 local time. Outside these hours, always reply HEARTBEAT_OK.`;
    }

    return message;
}

/**
 * Returns true if the agent's response indicates nothing to report.
 * Matches "HEARTBEAT_OK" (case-insensitive, trimmed, can have trailing punctuation).
 */
export function isHeartbeatOk(response: string): boolean {
    const trimmed = response.trim().toUpperCase();
    return trimmed === "HEARTBEAT_OK" || trimmed.startsWith("HEARTBEAT_OK");
}