/**
 * Scheduler — timer-based job engine for OpenPaw.
 *
 * Fires ScheduledJobs by calling the onFire callback when a job is due.
 * The caller (index.ts) wires onFire to enqueue InboundMessages so the
 * existing MessageProcessor handles them like any other message.
 *
 * Jobs are persisted to scheduler.json so they survive restarts.
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { ScheduledJob, ScheduleKind } from "./scheduler-types";
import { computeNextRun, formatInTimezone } from "./cron-utils";

export class Scheduler {
    private jobs = new Map<string, ScheduledJob>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private readonly TICK_MS = 10_000; // check every 10 seconds
    private readonly persistPath: string;

    /** Called when a job is due. Set from index.ts. */
    onFire?: (job: ScheduledJob) => void;

    constructor(persistPath = "./openpaw-memory/scheduler.json") {
        this.persistPath = path.resolve(persistPath);
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    /** Load jobs from disk. Call once before start(). */
    async load(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
            const raw = await fs.readFile(this.persistPath, "utf-8");
            const jobs: ScheduledJob[] = JSON.parse(raw);

            const now = Date.now();

            for (const job of jobs) {
                // Recompute nextRunAt for past-due recurring jobs
                if (job.nextRunAt <= now) {
                    if (job.schedule.kind === "at") {
                        if (job.deleteAfterRun) {
                            // One-shot past due — fire immediately on next tick
                            job.nextRunAt = now + 1000;
                        } else {
                            job.nextRunAt = now + 1000;
                        }
                    } else {
                        // Recurring — recompute from now
                        try {
                            job.nextRunAt = computeNextRun(job, new Date());
                        } catch {
                            job.nextRunAt = now + 60_000; // fallback: 1 minute
                        }
                    }
                }

                this.jobs.set(job.id, job);
            }

            console.log(`⏰ Scheduler loaded ${this.jobs.size} job(s) from disk.`);
        } catch (err: any) {
            if (err.code !== "ENOENT") {
                console.error("⚠️  Scheduler: failed to load jobs:", err.message);
            } else {
                console.log("⏰ Scheduler: no saved jobs found, starting fresh.");
            }
        }
    }

    /** Persist current jobs to disk. */
    private async persist(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
            const jobs = Array.from(this.jobs.values());
            await fs.writeFile(this.persistPath, JSON.stringify(jobs, null, 2), "utf-8");
        } catch (err: any) {
            console.error("⚠️  Scheduler: failed to persist jobs:", err.message);
        }
    }

    // ── Job Management ────────────────────────────────────────────────────────

    /** Add a new job. Computes nextRunAt and persists to disk. */
    async addJob(
        jobInput: Omit<ScheduledJob, "id" | "createdAt" | "nextRunAt">
    ): Promise<ScheduledJob> {
        const now = Date.now();
        const id = crypto.randomUUID();

        const job: ScheduledJob = {
            ...jobInput,
            id,
            createdAt: now,
            nextRunAt: computeNextRun(
                { ...jobInput, id, createdAt: now, nextRunAt: 0 },
                new Date()
            ),
        };

        this.jobs.set(id, job);
        await this.persist();

        console.log(
            `⏰ Job scheduled: "${job.name}" [${job.id.slice(0, 8)}] → next: ${formatInTimezone(job.nextRunAt, job.timezone)}`
        );

        return job;
    }

    /** Remove a job by ID. Returns true if found and removed. */
    async removeJob(id: string): Promise<boolean> {
        const existed = this.jobs.has(id);
        if (existed) {
            this.jobs.delete(id);
            await this.persist();
        }
        return existed;
    }

    /** Enable or disable a job. */
    async setEnabled(id: string, enabled: boolean): Promise<boolean> {
        const job = this.jobs.get(id);
        if (!job) return false;
        job.enabled = enabled;
        await this.persist();
        return true;
    }

    /** Return all jobs as an array. */
    listJobs(): ScheduledJob[] {
        return Array.from(this.jobs.values());
    }

    /** Get a single job by ID. */
    getJob(id: string): ScheduledJob | undefined {
        return this.jobs.get(id);
    }

    // ── Tick Loop ─────────────────────────────────────────────────────────────

    /** Start the scheduler tick loop. */
    start(): void {
        if (this.timer) return;
        console.log(`⏰ Scheduler started (tick every ${this.TICK_MS / 1000}s).`);
        this.timer = setInterval(() => {
            this.tick().catch((err) => {
                console.error("⚠️  Scheduler tick error:", err.message);
            });
        }, this.TICK_MS);
    }

    /** Stop the scheduler. */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log("⏰ Scheduler stopped.");
        }
    }

    /** Internal tick — find due jobs and fire them. */
    private async tick(): Promise<void> {
        const now = Date.now();
        const dueJobs = Array.from(this.jobs.values()).filter(
            (j) => j.enabled && j.nextRunAt <= now
        );

        for (const job of dueJobs) {
            try {
                // Guard against malformed jobs
                if (!job.message || !job.agentId) {
                    console.error(`⚠️  Skipping malformed job "${job.id}" — missing message or agentId`);
                    this.jobs.delete(job.id);
                    continue;
                }
                this.onFire?.(job);
                job.lastRunAt = now;

                if (job.deleteAfterRun) {
                    this.jobs.delete(job.id);
                } else {
                    // Recompute next run
                    try {
                        job.nextRunAt = computeNextRun(job, new Date());
                    } catch (err: any) {
                        console.error(`⚠️  Failed to compute nextRun for "${job.name}":`, err.message);
                        job.enabled = false;
                    }
                }
            } catch (err: any) {
                console.error(`⚠️  Error firing job "${job.name}":`, err.message);
            }
        }

        if (dueJobs.length > 0) {
            await this.persist();
        }
    }
}

/** Singleton instance — imported everywhere. */
export const scheduler = new Scheduler();