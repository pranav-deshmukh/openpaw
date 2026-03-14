/**
 * Cron & Schedule Utilities
 *
 * Pure implementation — no external dependencies.
 * Supports:
 *   - Standard 5-field cron expressions (minute hour day month weekday)
 *   - Interval strings: "30m", "1h", "6h", "1d"
 *   - One-shot ISO 8601 datetimes
 *   - IANA timezone-aware time display
 */

import type { ScheduledJob } from "./scheduler-types";

// ─── Interval Parser ─────────────────────────────────────────────────────────

/**
 * Parse a human-readable interval string into milliseconds.
 * Supports: 30s, 5m, 30m, 1h, 6h, 1d, 7d
 */
export function parseIntervalString(s: string): number {
    const match = s.trim().match(/^(\d+)(s|m|h|d)$/i);
    if (!match) {
        throw new Error(
            `Invalid interval "${s}". Use formats like: 30s, 5m, 30m, 1h, 6h, 1d`
        );
    }
    const value = parseInt(match[1], 10);
    switch (match[2].toLowerCase()) {
        case "s": return value * 1000;
        case "m": return value * 60 * 1000;
        case "h": return value * 60 * 60 * 1000;
        case "d": return value * 24 * 60 * 60 * 1000;
        default: throw new Error(`Unknown unit: ${match[2]}`);
    }
}

// ─── Cron Parser ─────────────────────────────────────────────────────────────

interface CronField {
    values: number[] | null; // null = wildcard (any)
    step: number;            // step value (*/2 = every 2)
}

function parseCronField(field: string, min: number, max: number): CronField {
    if (field === "*") return { values: null, step: 1 };

    // Step: */5 or 1-5/2
    if (field.includes("/")) {
        const [rangePart, stepStr] = field.split("/");
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step < 1) throw new Error(`Invalid step in cron field: ${field}`);

        if (rangePart === "*") {
            // */5 — every 5 starting from min
            const values: number[] = [];
            for (let i = min; i <= max; i += step) values.push(i);
            return { values, step };
        }

        // range/step
        const [startStr, endStr] = rangePart.split("-");
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : max;
        const values: number[] = [];
        for (let i = start; i <= end; i += step) values.push(i);
        return { values, step };
    }

    // Range: 1-5
    if (field.includes("-")) {
        const [startStr, endStr] = field.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        const values: number[] = [];
        for (let i = start; i <= end; i++) values.push(i);
        return { values, step: 1 };
    }

    // List: 1,3,5
    if (field.includes(",")) {
        const values = field.split(",").map((v) => parseInt(v.trim(), 10));
        return { values, step: 1 };
    }

    // Single value
    const v = parseInt(field, 10);
    if (isNaN(v)) throw new Error(`Invalid cron field value: ${field}`);
    return { values: [v], step: 1 };
}

function fieldMatches(field: CronField, value: number): boolean {
    if (field.values === null) return true;
    return field.values.includes(value);
}

/**
 * Given a 5-field cron expression, compute the next fire time after `from`.
 * Returns a unix ms timestamp.
 *
 * Field order: minute hour dayOfMonth month dayOfWeek
 * Example: "0 7 * * *" = every day at 07:00
 * Example: "0 9 * * 1" = every Monday at 09:00
 * Example: "30 8 * * 1-5" = weekdays at 08:30
 */
export function nextCronMs(expr: string, from: Date = new Date()): number {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(
            `Invalid cron expression "${expr}". Expected 5 fields: minute hour day month weekday`
        );
    }

    const minuteField = parseCronField(parts[0], 0, 59);
    const hourField = parseCronField(parts[1], 0, 23);
    const domField = parseCronField(parts[2], 1, 31);
    const monthField = parseCronField(parts[3], 1, 12);
    const dowField = parseCronField(parts[4], 0, 6);  // 0=Sunday

    // Start searching from the next minute
    const start = new Date(from.getTime());
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() + 1);

    // Search up to 2 years ahead to prevent infinite loops
    const limit = new Date(from.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);

    const candidate = new Date(start.getTime());

    while (candidate < limit) {
        // Check month (1-indexed)
        if (!fieldMatches(monthField, candidate.getMonth() + 1)) {
            candidate.setMonth(candidate.getMonth() + 1, 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }

        // Check day of month and day of week
        const domOk = fieldMatches(domField, candidate.getDate());
        const dowOk = fieldMatches(dowField, candidate.getDay());

        // If both fields are wildcards, either is fine.
        // If one is restricted, it must match.
        const dayOk = (parts[2] === "*" && parts[4] === "*")
            ? true
            : (parts[2] !== "*" && parts[4] !== "*")
                ? (domOk || dowOk)   // standard cron union for both specified
                : (parts[2] !== "*" ? domOk : dowOk);

        if (!dayOk) {
            candidate.setDate(candidate.getDate() + 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }

        // Check hour
        if (!fieldMatches(hourField, candidate.getHours())) {
            candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
            continue;
        }

        // Check minute
        if (!fieldMatches(minuteField, candidate.getMinutes())) {
            candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
            continue;
        }

        // All fields match — this is the next fire time
        return candidate.getTime();
    }

    throw new Error(`Could not compute next run for cron expression: "${expr}"`);
}

// ─── computeNextRun ───────────────────────────────────────────────────────────

/**
 * Given a ScheduledJob, compute the next nextRunAt timestamp from now.
 */
export function computeNextRun(job: ScheduledJob, from: Date = new Date()): number {
    switch (job.schedule.kind) {
        case "cron":
            return nextCronMs(job.schedule.expr, from);

        case "every":
            return from.getTime() + job.schedule.intervalMs;

        case "at":
            return new Date(job.schedule.isoTime).getTime();

        default:
            throw new Error(`Unknown schedule kind: ${(job.schedule as any).kind}`);
    }
}

// ─── Timezone Display ─────────────────────────────────────────────────────────

/**
 * Format a unix ms timestamp for display in a given timezone.
 * Falls back to local time if the timezone is invalid.
 */
export function formatInTimezone(ms: number, timezone?: string): string {
    try {
        return new Date(ms).toLocaleString("en-IN", {
            timeZone: timezone ?? "Asia/Kolkata",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        });
    } catch {
        return new Date(ms).toLocaleString();
    }
}

/**
 * Parse a natural-language time description into an ISO datetime string.
 * This is used to help the agent when users say things like "tomorrow at 3am".
 * Returns a UTC ISO string.
 *
 * Supported patterns:
 *   "tomorrow at HH:MM" / "tomorrow at H:MMam/pm"
 *   "today at HH:MM"
 *   "in Xm/h/d" (relative)
 *   ISO strings passed through directly
 */
export function parseNaturalTime(
    input: string,
    userTimezone = "Asia/Kolkata"
): string {
    const s = input.trim().toLowerCase();

    // Already an ISO string
    if (/^\d{4}-\d{2}-\d{2}T/.test(input)) {
        return new Date(input).toISOString();
    }

    // Relative: "in 30m", "in 2h", "in 1d"
    const relMatch = s.match(/^in\s+(\d+)(m|h|d|s)$/);
    if (relMatch) {
        const ms = parseIntervalString(`${relMatch[1]}${relMatch[2]}`);
        return new Date(Date.now() + ms).toISOString();
    }

    // "today at HH:MM" or "tomorrow at HH:MM"
    const dayTimeMatch = s.match(/^(today|tomorrow)\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/);
    if (dayTimeMatch) {
        const dayOffset = dayTimeMatch[1] === "tomorrow" ? 1 : 0;
        let hours = parseInt(dayTimeMatch[2], 10);
        const minutes = parseInt(dayTimeMatch[3], 10);
        const ampm = dayTimeMatch[4];

        if (ampm === "pm" && hours !== 12) hours += 12;
        if (ampm === "am" && hours === 12) hours = 0;

        // Get current date in user timezone
        const now = new Date();
        const userNow = new Date(now.toLocaleString("en-US", { timeZone: userTimezone }));
        userNow.setDate(userNow.getDate() + dayOffset);
        userNow.setHours(hours, minutes, 0, 0);

        // Convert back to UTC
        const offsetMs = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: userTimezone })).getTime();
        return new Date(userNow.getTime() + offsetMs).toISOString();
    }

    // "HH:MM" without day qualifier — assume today, or tomorrow if time has passed
    const timeOnlyMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
    if (timeOnlyMatch) {
        let hours = parseInt(timeOnlyMatch[1], 10);
        const minutes = parseInt(timeOnlyMatch[2], 10);
        const ampm = timeOnlyMatch[3];

        if (ampm === "pm" && hours !== 12) hours += 12;
        if (ampm === "am" && hours === 12) hours = 0;

        const now = new Date();
        const userNow = new Date(now.toLocaleString("en-US", { timeZone: userTimezone }));
        userNow.setHours(hours, minutes, 0, 0);

        const offsetMs = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: userTimezone })).getTime();
        let result = new Date(userNow.getTime() + offsetMs);

        // If the time has already passed today, schedule for tomorrow
        if (result.getTime() <= Date.now()) {
            result = new Date(result.getTime() + 24 * 60 * 60 * 1000);
        }

        return result.toISOString();
    }

    throw new Error(
        `Could not parse time: "${input}". Try formats like: "tomorrow at 3:00pm", "in 30m", "2024-12-25T03:00:00+05:30"`
    );
}