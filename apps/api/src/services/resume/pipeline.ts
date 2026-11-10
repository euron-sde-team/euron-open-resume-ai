/**
 * The resume AI pipeline: what a `resume-ai.run` job does.
 *
 *   upload  -> analysis job: extract text, parseDocument, analyze (analysis + rewrite + cover letter)
 *           -> interview_non_technical job (free: it rides on the run charged for the analysis)
 *   on demand: one job per interview track / roadmap / projects, one run each
 *
 * Job data is { resumeId, userId, component } only; the content is read from the database
 * and storage here. Every step is idempotent: a job takes its component row with a
 * conditional UPDATE (`claim`), so a duplicate delivery, a retry after the work finished or
 * a second worker does nothing. A failed attempt goes back to the queue (BullMQ backoff) until
 * MAX_ATTEMPTS; the final failure marks the component failed with a message safe to show and
 * gives the charged run back. Problems with the user's file are never retried.
 *
 * JOBS_MODE=inline has no queue to retry through, so the handler loops the attempts itself.
 */
import type { CoverLetter, InterviewGroup, ResumeDocument } from "@open-resume/types";
import { z } from "zod";
import { config } from "../../core/config";
import { captureError } from "../../core/logger";
import { id as idSchema } from "../../core/validate";
import { db, type Executor } from "../../db/kysely";
import { enqueue, type JobDefinitions, type ResumeJobComponent } from "../../jobs/registry";
import { resumeComponentRepo } from "../../repositories/resume-component.repository";
import { resumeRepo, type ResumeRow } from "../../repositories/resume.repository";
import { storage } from "../../integrations/storage";
import { refundRuns } from "../quota.service";
import type { AiContext, TargetJob } from "./ai-tasks";
import { COMPONENTS, DEFAULT_PIPELINE, deriveStatus, MAX_ATTEMPTS } from "./components";
import { aiTasks } from "./deps";
import { isEmptyDocument, normaliseDocument } from "./document";
import { ExtractError, extractText, sniffFile } from "./extract";

/** A failure with a message that is safe to show the user. `retryable: false` skips the retries. */
export class PipelineError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

const GENERIC = "The AI step did not finish. Please retry in a moment.";

export function userMessage(err: unknown): string {
  if (err instanceof PipelineError || err instanceof ExtractError) return err.message;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return "The AI service took too long to answer. Please retry.";
  return GENERIC;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof PipelineError) return err.retryable;
  if (err instanceof ExtractError) return false;
  return true;
}

/** Recompute and store the resume's overall status from its component rows. */
export async function syncStatus(resumeId: string, exec: Executor = db): Promise<void> {
  const rows = await resumeComponentRepo.list(resumeId, exec);
  await resumeRepo.setStatus(resumeId, deriveStatus(rows.map((r) => ({ kind: r.kind, status: r.status, claimed: r.claimed_at !== null }))), exec);
}

/**
 * Put the rows a job covers in the queue. The first row carries the charge; false when the
 * job is already queued or running (nothing changed).
 */
export async function requestJob(resumeId: string, job: ResumeJobComponent, cost: number, exec: Executor = db): Promise<boolean> {
  const [primary, ...rest] = COMPONENTS[job].covers;
  if (!(await resumeComponentRepo.request(resumeId, primary!, cost, exec))) return false;
  for (const kind of rest) await resumeComponentRepo.request(resumeId, kind, 0, exec);
  return true;
}

/** Hand a requested job to the queue; if that fails, fail it and give the run back. */
export async function dispatch(data: JobDefinitions["resume-ai.run"]): Promise<void> {
  try {
    await enqueue("resume-ai.run", data);
  } catch (err) {
    captureError(err, { where: "resume.dispatch", resumeId: data.resumeId, component: data.component });
    await failJob(data, "We could not start this job. Please retry.");
  }
}

async function failJob(data: JobDefinitions["resume-ai.run"], message: string): Promise<void> {
  const def = COMPONENTS[data.component];
  const charged = await db.transaction().execute(async (trx) => {
    const n = await resumeComponentRepo.fail(data.resumeId, def.covers, message, trx);
    if (data.component === "analysis") await resumeComponentRepo.cancelQueued(data.resumeId, DEFAULT_PIPELINE.filter((c) => c !== "analysis").flatMap((c) => COMPONENTS[c].covers), trx);
    await syncStatus(data.resumeId, trx);
    return n;
  });
  if (charged > 0) await refundRuns(data.userId, charged, def.chargeKind).catch((err) => captureError(err, { where: "resume.refund" }));
}

// ─── Executors ──────────────────────────────────────────────────────────────

interface Run {
  resume: ResumeRow;
  job: TargetJob;
  ctx: AiContext;
}

const jsonOf = (v: unknown) => JSON.stringify(v);

function documentOf(resume: ResumeRow): ResumeDocument {
  const doc = (resume.improved ?? resume.original) as ResumeDocument | null;
  if (!doc || isEmptyDocument(doc)) throw new PipelineError("Analyse this resume first, then try again.");
  return doc;
}

async function runAnalysis({ resume, job, ctx }: Run): Promise<void> {
  let original = resume.original as ResumeDocument | null;
  if (!original) {
    if (!resume.file_key) throw new PipelineError("This resume has no content to analyse.");
    const buf = await storage()
      .get(resume.file_key)
      .catch(() => {
        throw new PipelineError("The uploaded file is no longer available. Upload it again.");
      });
    const kind = sniffFile(buf, resume.file_name ?? "");
    if (!kind) throw new PipelineError("That file type is not supported.");
    const text = await extractText(buf, kind);
    original = normaliseDocument(await aiTasks().parseDocument(text, ctx));
    if (isEmptyDocument(original)) throw new PipelineError("We could not find resume content in that file. Check that it is a resume and try again.");
    await resumeRepo.update(resume.id, resume.user_id, { original: jsonOf(original) });
  }
  const result = await aiTasks().analyze(original, job, ctx);
  const improved = normaliseDocument(result.improved);
  if (isEmptyDocument(improved)) throw new PipelineError("The rewrite came back empty. Please retry.", true);
  const score = Math.max(0, Math.min(100, Math.round(Number(result.after.score) || 0)));
  const letter: CoverLetter = result.coverLetter;
  await db.transaction().execute(async (trx) => {
    await resumeRepo.update(
      resume.id,
      resume.user_id,
      { improved: jsonOf(improved), analysis: jsonOf({ before: result.before, after: result.after }), cover_letter: jsonOf(letter), score },
      trx,
    );
    await resumeComponentRepo.markDone(resume.id, "analysis", null, trx);
    await resumeComponentRepo.markDone(resume.id, "rewrite", null, trx);
    await syncStatus(resume.id, trx);
  });
}

async function runComponent(kind: Exclude<ResumeJobComponent, "analysis">, { resume, job, ctx }: Run): Promise<void> {
  const doc = documentOf(resume);
  const def = COMPONENTS[kind];
  let data: unknown;
  if (def.track) {
    const groups: InterviewGroup[] = await aiTasks().interview(def.track, doc, job, ctx);
    if (!Array.isArray(groups) || groups.length === 0) throw new PipelineError("No questions came back. Please retry.", true);
    data = groups;
  } else if (kind === "roadmap") {
    data = await aiTasks().roadmap(doc, job, ctx);
  } else {
    const ideas = await aiTasks().projects(doc, job, ctx);
    if (!Array.isArray(ideas) || ideas.length === 0) throw new PipelineError("No project ideas came back. Please retry.", true);
    data = ideas;
  }
  await db.transaction().execute(async (trx) => {
    await resumeComponentRepo.markDone(resume.id, kind, data, trx);
    await syncStatus(resume.id, trx);
  });
}

// ─── The job ────────────────────────────────────────────────────────────────

const jobSchema = z.object({
  resumeId: idSchema(),
  userId: idSchema(),
  component: z.enum(["analysis", "interview_non_technical", "interview_dsa", "interview_programming", "interview_system_design", "roadmap", "projects"]),
});

type Outcome = "done" | "skipped" | "retry" | "failed";

async function attempt(data: JobDefinitions["resume-ai.run"]): Promise<Outcome> {
  const def = COMPONENTS[data.component];
  const attempts = await resumeComponentRepo.claim(data.resumeId, def.covers[0]!);
  if (attempts === null) return "skipped";
  const resume = await resumeRepo.findOwned(data.resumeId, data.userId);
  if (!resume) return "skipped";
  await resumeComponentRepo.touch(data.resumeId, def.covers.slice(1));
  await syncStatus(data.resumeId);

  const run: Run = {
    resume,
    job: { ...(resume.jd ? { jd: resume.jd } : {}), ...(resume.company ? { company: resume.company } : {}) },
    ctx: { userId: data.userId, signal: AbortSignal.timeout(180_000) },
  };
  try {
    if (data.component === "analysis") await runAnalysis(run);
    else await runComponent(data.component, run);
  } catch (err) {
    captureError(err, { where: "resume.pipeline", resumeId: data.resumeId, component: data.component, attempt: attempts });
    if (isRetryable(err) && attempts < MAX_ATTEMPTS) {
      await resumeComponentRepo.release(data.resumeId, def.covers, userMessage(err));
      await syncStatus(data.resumeId);
      return "retry";
    }
    await failJob(data, userMessage(err));
    return "failed";
  }

  // The default pipeline continues with the non-technical interview set, at no extra charge.
  if (data.component === "analysis") {
    const next = DEFAULT_PIPELINE.find((c) => c !== "analysis");
    if (next && (await requestJob(data.resumeId, next, 0))) await dispatch({ resumeId: data.resumeId, userId: data.userId, component: next });
  }
  return "done";
}

export async function runResumeJob(raw: unknown): Promise<void> {
  const data = jobSchema.parse(raw);
  for (;;) {
    const outcome = await attempt(data);
    if (outcome !== "retry") return;
    // BullMQ re-delivers with backoff; inline mode has no queue, so go again right here.
    if (config.JOBS_MODE !== "inline") throw new Error("resume job attempt failed; retrying");
  }
}

