import type { FastifyBaseLogger } from 'fastify';

export interface Job {
  name: string;
  /** How often the job is evaluated. Jobs must be idempotent: they check state, not time ticks,
   *  so nothing is missed when the laptop was asleep. */
  everyMs: number;
  run(): void | Promise<void>;
}

const jobs: Job[] = [];
const lastRun = new Map<string, number>();
const running = new Set<string>();
let timer: NodeJS.Timeout | null = null;

export function registerJob(job: Job) {
  if (!jobs.find((j) => j.name === job.name)) jobs.push(job);
}

export async function runJobsNow(log?: FastifyBaseLogger, force = false) {
  for (const job of jobs) {
    const due = force || Date.now() - (lastRun.get(job.name) ?? 0) >= job.everyMs;
    if (!due || running.has(job.name)) continue;
    running.add(job.name);
    lastRun.set(job.name, Date.now());
    try {
      await job.run();
    } catch (err) {
      log?.error({ err, job: job.name }, `Job "${job.name}" failed`);
    } finally {
      running.delete(job.name);
    }
  }
}

export function startScheduler(log: FastifyBaseLogger) {
  if (timer) return;
  // First pass shortly after startup (catches up on anything missed while the laptop was off).
  setTimeout(() => void runJobsNow(log), 5_000).unref();
  timer = setInterval(() => void runJobsNow(log), 30_000);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function listJobs() {
  return jobs.map((j) => ({ name: j.name, everyMs: j.everyMs, lastRun: lastRun.get(j.name) ?? null }));
}
