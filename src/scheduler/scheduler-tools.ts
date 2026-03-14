/**
 * Scheduler Tools — allow the agent to manage its own schedule.
 */

import { BaseTool, ToolParametersSchema } from "../tools/base-tool";
import type { Scheduler } from "../scheduler/scheduler";
import type { ScheduledJob } from "../scheduler/scheduler-types";
import { parseIntervalString, formatInTimezone, parseNaturalTime, nextCronMs } from "../scheduler/cron-utils";

// ─── schedule_at ─────────────────────────────────────────────────────────────

export class ScheduleAtTool extends BaseTool {
    readonly name = "schedule_at";

    readonly description =
        "Schedule a one-time reminder or task at a specific time. " +
        "Use this when the user says things like 'remind me at 3am tomorrow', " +
        "'remind me about my flight at 5:30pm', 'wake me up at 7am', etc. " +
        "The job fires once and is automatically deleted after running. " +
        "Always use the user's timezone when interpreting times.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Short label for the reminder e.g. 'Flight reminder', 'Meeting alert'",
            },
            time: {
                type: "string",
                description:
                    "When to fire. Supports: " +
                    "ISO 8601 with offset ('2024-12-25T03:00:00+05:30'), " +
                    "natural language ('tomorrow at 3:00am', 'today at 5:30pm', 'in 30m', 'in 2h'), " +
                    "time only ('15:30', '3:00pm' — schedules for today or tomorrow if passed)",
            },
            message: {
                type: "string",
                description:
                    "What to tell the agent when this fires. Should describe the reminder clearly. " +
                    "e.g. 'The user asked to be reminded about their flight to Mumbai at this time.'",
            },
            agentId: {
                type: "string",
                description: "Which agent handles this job. Defaults to 'personal'.",
            },
            timezone: {
                type: "string",
                description: "User's IANA timezone e.g. 'Asia/Kolkata'. Used for time parsing and display.",
            },
        },
        required: ["name", "time", "message"],
    };

    private scheduler: Scheduler;

    constructor(scheduler: Scheduler) {
        super();
        this.scheduler = scheduler;
    }

    async execute(args: Record<string, unknown>): Promise<string> {
        const name = (args.name as string) || (args.label as string) || (args.title as string);
        const timeInput = (args.time as string) || (args.isoTime as string) || (args.datetime as string) || (args.when as string);
        const message = (args.message as string) || (args.task as string) || (args.text as string) || name;
        const agentId = (args.agentId as string) ?? "personal";
        const timezone = (args.timezone as string) ?? "Asia/Kolkata";

        if (!name) return `❌ Missing required field: "name". Provide a short label for this reminder.`;
        if (!timeInput) return `❌ Missing required field: "time". Provide when to fire e.g. "tomorrow at 3:00pm", "in 30m".`;
        if (!message) return `❌ Missing required field: "message". Provide what to tell the agent when this fires.`;

        let isoTime: string;
        try {
            isoTime = parseNaturalTime(timeInput, timezone);
        } catch (err: any) {
            return `❌ Could not parse time "${timeInput}": ${err.message}`;
        }

        const fireMs = new Date(isoTime).getTime();
        if (fireMs <= Date.now()) {
            return `❌ The time "${timeInput}" is in the past. Please provide a future time.`;
        }

        const job = await this.scheduler.addJob({
            name,
            schedule: { kind: "at", isoTime },
            agentId,
            message,
            isolated: true,
            timezone,
            enabled: true,
            deleteAfterRun: true,
            isHeartbeat: false,
        });

        const displayTime = formatInTimezone(fireMs, timezone);
        return `✅ Reminder set: "${name}" will fire at ${displayTime} (${timezone}).\nJob ID: ${job.id.slice(0, 8)}`;
    }
}

// ─── schedule_every ──────────────────────────────────────────────────────────

export class ScheduleEveryTool extends BaseTool {
    readonly name = "schedule_every";

    readonly description =
        "Schedule a recurring task at a fixed interval. " +
        "Use for things like 'check my email every hour', 'remind me every 30 minutes', " +
        "'send me a summary every 6 hours'. " +
        "Supported intervals: 30s, 5m, 30m, 1h, 6h, 12h, 1d.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Short label e.g. 'Hourly email check', 'Daily standup reminder'",
            },
            interval: {
                type: "string",
                description: "How often to fire. Examples: '30m', '1h', '6h', '1d'",
            },
            message: {
                type: "string",
                description: "What to tell the agent each time this fires.",
            },
            agentId: {
                type: "string",
                description: "Which agent handles this. Defaults to 'personal'.",
            },
            timezone: {
                type: "string",
                description: "User's IANA timezone for display. e.g. 'Asia/Kolkata'",
            },
        },
        required: ["name", "interval", "message"],
    };

    private scheduler: Scheduler;

    constructor(scheduler: Scheduler) {
        super();
        this.scheduler = scheduler;
    }

    async execute(args: Record<string, unknown>): Promise<string> {
        const name = (args.name as string) || (args.label as string) || (args.title as string);
        const intervalStr = (args.interval as string) || (args.every as string) || (args.frequency as string);
        const message = (args.message as string) || (args.task as string) || (args.text as string) || name;
        const agentId = (args.agentId as string) ?? "personal";
        const timezone = (args.timezone as string) ?? "Asia/Kolkata";

        if (!name) return `❌ Missing required field: "name".`;
        if (!intervalStr) return `❌ Missing required field: "interval". Use formats like "30m", "1h", "1d".`;

        let intervalMs: number;
        try {
            intervalMs = parseIntervalString(intervalStr);
        } catch (err: any) {
            return `❌ Invalid interval "${intervalStr}": ${err.message}`;
        }

        const job = await this.scheduler.addJob({
            name,
            schedule: { kind: "every", intervalMs },
            agentId,
            message,
            isolated: true,
            timezone,
            enabled: true,
            deleteAfterRun: false,
            isHeartbeat: false,
        });

        const displayNext = formatInTimezone(job.nextRunAt, timezone);
        return `✅ Recurring job set: "${name}" every ${intervalStr}.\nFirst run: ${displayNext}\nJob ID: ${job.id.slice(0, 8)}`;
    }
}

// ─── schedule_cron ───────────────────────────────────────────────────────────

export class ScheduleCronTool extends BaseTool {
    readonly name = "schedule_cron";

    readonly description =
        "Schedule a recurring task using a standard cron expression (5 fields). " +
        "Use for precise schedules like 'every day at 7am', 'every Monday at 9am', " +
        "'every weekday at 8:30am'. " +
        "Cron format: 'minute hour day month weekday'. " +
        "Examples: '0 7 * * *' = daily 7am, '0 9 * * 1' = every Monday 9am, '30 8 * * 1-5' = weekdays 8:30am.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Short label e.g. 'Morning briefing', 'Weekly review'",
            },
            expr: {
                type: "string",
                description:
                    "5-field cron expression. " +
                    "Fields: minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6, 0=Sunday). " +
                    "Examples: '0 7 * * *' = daily at 7am UTC, '0 9 * * 1' = every Monday at 9am UTC",
            },
            message: {
                type: "string",
                description: "What to tell the agent each time this fires.",
            },
            agentId: {
                type: "string",
                description: "Which agent handles this. Defaults to 'personal'.",
            },
            timezone: {
                type: "string",
                description:
                    "IMPORTANT: Cron times are in UTC. If the user is in Asia/Kolkata (IST, UTC+5:30), " +
                    "subtract 5:30 from their desired time. e.g. 7am IST = 1:30am UTC = '30 1 * * *'. " +
                    "Store the user's timezone here for display.",
            },
        },
        required: ["name", "expr", "message"],
    };

    private scheduler: Scheduler;

    constructor(scheduler: Scheduler) {
        super();
        this.scheduler = scheduler;
    }

    async execute(args: Record<string, unknown>): Promise<string> {
        const name = (args.name as string) || (args.label as string) || (args.title as string);
        const expr = (args.expr as string) || (args.cron as string) || (args.expression as string);
        const message = (args.message as string) || (args.task as string) || (args.text as string) || name;
        const agentId = (args.agentId as string) ?? "personal";
        const timezone = (args.timezone as string) ?? "Asia/Kolkata";

        if (!name) return `❌ Missing required field: "name".`;
        if (!expr) return `❌ Missing required field: "expr". Provide a 5-field cron expression e.g. "0 7 * * *".`;

        try {
            nextCronMs(expr); // validate — throws if invalid
        } catch (err: any) {
            return `❌ Invalid cron expression "${expr}": ${err.message}`;
        }

        const job = await this.scheduler.addJob({
            name,
            schedule: { kind: "cron", expr },
            agentId,
            message,
            isolated: true,
            timezone,
            enabled: true,
            deleteAfterRun: false,
            isHeartbeat: false,
        });

        const displayNext = formatInTimezone(job.nextRunAt, timezone);
        return `✅ Cron job set: "${name}" (${expr}).\nNext run: ${displayNext} (${timezone})\nJob ID: ${job.id.slice(0, 8)}\n\nNote: Cron expressions use UTC. If times seem off, check the UTC offset for your timezone.`;
    }
}

// ─── schedule_list ───────────────────────────────────────────────────────────

export class ScheduleListTool extends BaseTool {
    readonly name = "schedule_list";

    readonly description =
        "List all scheduled jobs — reminders, recurring tasks, and heartbeats. " +
        "Use this when the user asks 'what do I have scheduled', 'show my reminders', etc.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            timezone: {
                type: "string",
                description: "IANA timezone for displaying times. Defaults to 'Asia/Kolkata'.",
            },
        },
        required: [],
    };

    private scheduler: Scheduler;

    constructor(scheduler: Scheduler) {
        super();
        this.scheduler = scheduler;
    }

    async execute(args: Record<string, unknown>): Promise<string> {
        const timezone = (args.timezone as string) ?? "Asia/Kolkata";
        const jobs = this.scheduler.listJobs().filter((j) => !j.isHeartbeat);

        if (jobs.length === 0) {
            return "📅 No scheduled jobs. Use schedule_at, schedule_every, or schedule_cron to add one.";
        }

        const lines: string[] = [`📅 Scheduled Jobs (${jobs.length}):\n`];

        for (const job of jobs) {
            const status = job.enabled ? "✅" : "⏸️";
            const nextDisplay = formatInTimezone(job.nextRunAt, timezone);
            const scheduleDesc = describeSchedule(job);

            lines.push(
                `${status} "${job.name}"\n` +
                `   ID: ${job.id.slice(0, 8)} | Agent: ${job.agentId}\n` +
                `   Schedule: ${scheduleDesc}\n` +
                `   Next run: ${nextDisplay} (${timezone})\n`
            );
        }

        return lines.join("\n");
    }
}

function describeSchedule(job: ScheduledJob): string {
    switch (job.schedule.kind) {
        case "at": return `One-time at ${job.schedule.isoTime}`;
        case "every": return `Every ${job.schedule.intervalMs / 60000} minute(s)`;
        case "cron": return `Cron: ${job.schedule.expr}`;
        default: return "Unknown";
    }
}

// ─── schedule_delete ─────────────────────────────────────────────────────────

export class ScheduleDeleteTool extends BaseTool {
    readonly name = "schedule_delete";

    readonly description =
        "Delete a scheduled job by its ID. " +
        "Use when the user says 'cancel my reminder', 'remove that job', " +
        "'I don't need that reminder anymore'. Use schedule_list first to find the ID.";

    readonly parameters: ToolParametersSchema = {
        type: "object",
        properties: {
            id: {
                type: "string",
                description:
                    "The job ID to delete. Can be the full UUID or just the first 8 characters " +
                    "as shown in schedule_list output.",
            },
        },
        required: ["id"],
    };

    private scheduler: Scheduler;

    constructor(scheduler: Scheduler) {
        super();
        this.scheduler = scheduler;
    }

    async execute(args: Record<string, unknown>): Promise<string> {
        const inputId = args.id as string;

        let targetId = inputId;
        if (inputId.length < 36) {
            const match = this.scheduler
                .listJobs()
                .find((j) => j.id.startsWith(inputId));
            if (!match) {
                return `❌ No job found with ID starting with "${inputId}". Use schedule_list to see all jobs.`;
            }
            targetId = match.id;
        }

        const deleted = await this.scheduler.removeJob(targetId);
        if (!deleted) {
            return `❌ Job "${inputId}" not found. Use schedule_list to see all jobs.`;
        }

        return `✅ Job "${inputId}" deleted successfully.`;
    }
}