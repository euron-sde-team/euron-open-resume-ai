/**
 * Background jobs. A job is a named handler with a JSON payload. Services enqueue jobs
 * through `Effects.job(...)`, so nothing is enqueued for a transaction that rolled back.
 *
 * JOBS_MODE=queue  BullMQ on Redis; the worker process (worker.ts) runs the handlers.
 * JOBS_MODE=inline the handler runs in-process right after commit. Used by the
 *                  integration tests so assertions are deterministic.
 */
import type { ComponentKind } from "@open-resume/types";
import { Queue, type JobsOptions } from "bullmq";
import { config } from "../core/config";
import { captureError, logger } from "../core/logger";
import { redisConnection } from "../integrations/redis";

export const QUEUES = ["maintenance", "resume-ai"] as const;
export type QueueName = (typeof QUEUES)[number];

/** The component a resume-ai job runs ("analysis" covers rewrite too). */
export type ResumeJobComponent = Exclude<ComponentKind, "rewrite">;

/** Retry policy per queue; resume-ai gives up after 3 attempts (the pipeline counts them too). */
const DEFAULT_ATTEMPTS: Record<QueueName, { attempts: number; delay: number }> = {
  maintenance: { attempts: 5, delay: 5_000 },
  "resume-ai": { attempts: 3, delay: 10_000 },
};

export interface JobDefinitions {
  "maintenance.lift-suspensions": Record<string, never>;
  /** Erase accounts whose deletion grace period is over. */
  "maintenance.purge-accounts": Record<string, never>;
  /** One unit of AI work on a resume. Ids only: the content is read from the database. */
  "resume-ai.run": { resumeId: string; userId: string; component: ResumeJobComponent };
}
export type JobName = keyof JobDefinitions;

type Handler<N extends JobName> = (data: JobDefinitions[N]) => Promise<void>;
const handlers = new Map<JobName, Handler<any>>();

export function registerJob<N extends JobName>(name: N, handler: Handler<N>): void {
  handlers.set(name, handler);
}

export function getHandler<N extends JobName>(name: N): Handler<N> | undefined {
  return handlers.get(name);
}

export function queueFor(name: JobName): QueueName {
  return name.split(".")[0] as QueueName;
}

const queues = new Map<QueueName, Queue>();
function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: DEFAULT_ATTEMPTS[name].attempts,
        backoff: { type: "exponential", delay: DEFAULT_ATTEMPTS[name].delay },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    queues.set(name, q);
  }
  return q;
}

export async function enqueue<N extends JobName>(name: N, data: JobDefinitions[N], opts: JobsOptions = {}): Promise<void> {
  if (config.JOBS_MODE === "inline") {
    const handler = getHandler(name);
    if (!handler) {
      logger.warn({ job: name }, "inline job has no handler registered");
      return;
    }
    try {
      await handler(data);
    } catch (err) {
      captureError(err, { job: name });
    }
    return;
  }
  await queue(queueFor(name)).add(name, data, opts);
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
