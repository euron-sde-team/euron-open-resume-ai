/**
 * Resumes: upload or build one, list and read, retry, tailor, generate extra components,
 * delete, download and render.
 *
 * Rules every function here keeps:
 *   - a resume is only ever read or written through (id, user_id); someone else's id is a 404;
 *   - runs are checked (assertRunsLeft), then charged (chargeRuns, atomic), then the work is
 *     queued; a failure on our side before the job is queued gives the runs back, and so does
 *     the pipeline's final failure (see pipeline.ts);
 *   - jobs carry ids only; files go to storage through the API, never from a client-supplied key.
 */
import type { ComponentKind, DownloadKind, ResumeDetail, ResumeDocument, ResumeStatusView, ResumeSummary, TemplateId, Page } from "@open-resume/types";
import { sql } from "kysely";
import type { Actor, RequestMeta } from "../../core/context";
import { requireActive, requireActor } from "../../core/context";
import { withTransaction } from "../../core/effects";
import { HttpError, badRequest, conflict, notFound, unprocessable } from "../../core/errors";
import { newId } from "../../core/ids";
import { captureError } from "../../core/logger";
import { db, type Executor } from "../../db/kysely";
import type { ResumeJobComponent } from "../../jobs/registry";
import { PdfUnavailableError } from "./render/pdf";
import { storage } from "../../integrations/storage";
import { asTemplateId, toDetail, toStatusView, toSummary } from "../../presenters/resume.presenter";
import { resumeComponentRepo } from "../../repositories/resume-component.repository";
import { decodeTime, timePage } from "../../repositories/keyset";
import { resumeRepo, type ResumeRow } from "../../repositories/resume.repository";
import { audit } from "../audit.service";
import { assertResumeSlot, assertRunsLeft, chargeRuns, limitsFor, nextMonthStart, QuotaExceededError, refundRuns } from "../quota.service";
import { COMPONENTS, jobFor, ON_DEMAND_KINDS, type OnDemandKind } from "./components";
import { resumeRendererDep } from "./deps";
import { isEmptyDocument } from "./document";
import { ExtractError, extractText, sniffFile, type FileKind } from "./extract";
import { dispatch, requestJob, syncStatus } from "./pipeline";
import type { UploadedFile } from "../../middleware/multipart";

/** Hard cap on an uploaded resume, whatever the tier allows. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_JD_CHARS = 20_000;

/** The PDF engine is optional at runtime: a missing or saturated Chromium is a 503, not a crash. */
async function renderPdfOr503(renderer: ReturnType<typeof resumeRendererDep>, doc: ResumeDocument, template: TemplateId) {
  try {
    return await renderer.renderPdf(doc, template);
  } catch (err) {
    if (err instanceof PdfUnavailableError) throw new HttpError(503, "PDF export is not available right now", "PDF_UNAVAILABLE");
    throw err;
  }
}

// ─── Quota helpers ──────────────────────────────────────────────────────────

function quotaError(err: QuotaExceededError): HttpError {
  return new HttpError(429, err.message, "QUOTA_EXHAUSTED", { limit: err.limit, used: err.used, resetsAt: nextMonthStart().toISOString() });
}

/** The upload cap for this user in bytes: their tier's max_upload_mb, never above 10 MB. */
export async function uploadLimitBytes(userId: string): Promise<number> {
  const { maxUploadMb } = await limitsFor(userId);
  return maxUploadMb === null ? MAX_UPLOAD_BYTES : Math.min(MAX_UPLOAD_BYTES, maxUploadMb * 1024 * 1024);
}

async function assertSlot(userId: string, exec: Executor = db): Promise<void> {
  try {
    await assertResumeSlot(userId, await resumeRepo.count(userId, exec));
  } catch (err) {
    if (err instanceof HttpError && err.code === "RESUME_LIMIT") {
      const { maxResumes } = await limitsFor(userId, exec);
      throw conflict(`You can keep up to ${maxResumes} resumes. Delete one to add another.`, "RESUME_LIMIT", { limit: maxResumes });
    }
    throw err;
  }
}

async function assertRuns(userId: string, cost: number): Promise<void> {
  try {
    await assertRunsLeft(userId, cost);
  } catch (err) {
    throw err instanceof QuotaExceededError ? quotaError(err) : err;
  }
}

/** Charge several jobs; if one is refused, the ones already charged are given back. */
async function chargeJobs(userId: string, jobs: ResumeJobComponent[]): Promise<void> {
  const done: ResumeJobComponent[] = [];
  try {
    for (const job of jobs) {
      await chargeRuns(userId, COMPONENTS[job].cost, COMPONENTS[job].chargeKind);
      done.push(job);
    }
  } catch (err) {
    await refundJobs(userId, done);
    throw err instanceof QuotaExceededError ? quotaError(err) : err;
  }
}

async function refundJobs(userId: string, jobs: ResumeJobComponent[]): Promise<void> {
  for (const job of jobs) await refundRuns(userId, COMPONENTS[job].cost, COMPONENTS[job].chargeKind).catch((err) => captureError(err, { where: "resume.refund" }));
}

// ─── Create ─────────────────────────────────────────────────────────────────

interface StartSpec {
  id: string;
  source: "upload" | "builder";
  title: string;
  file?: { key: string; name: string; mime: string; body: Buffer };
  original: ResumeDocument | null;
  jd: string | null;
  company: string | null;
  templateId: TemplateId;
  parentId: string | null;
  action: string;
}

/** Charge, store, insert, queue. Everything before the queue is undone on failure. */
async function startResume(actor: Actor, spec: StartSpec, meta: RequestMeta): Promise<ResumeSummary> {
  await assertSlot(actor.id);
  await assertRuns(actor.id, COMPONENTS.analysis.cost);
  await chargeJobs(actor.id, ["analysis"]);
  let stored = false;
  try {
    if (spec.file) {
      await storage().put(spec.file.key, spec.file.body, spec.file.mime);
      stored = true;
    }
    await withTransaction(async (trx, fx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${"resume-slot:" + actor.id}))`.execute(trx);
      await assertSlot(actor.id, trx);
      await resumeRepo.insert(
        {
          id: spec.id,
          user_id: actor.id,
          title: spec.title,
          source: spec.source,
          status: "queued",
          file_name: spec.file?.name ?? null,
          file_key: spec.file?.key ?? null,
          file_mime: spec.file?.mime ?? null,
          file_size: spec.file?.body.length ?? null,
          jd: spec.jd,
          company: spec.company,
          // A resume analysed against a job description is tailored, whether it started as
          // an upload with a JD or as a tailored copy of another resume.
          is_tailored: spec.parentId !== null || !!spec.jd,
          parent_id: spec.parentId,
          template_id: spec.templateId,
          original: spec.original ? JSON.stringify(spec.original) : null,
        },
        trx,
      );
      await requestJob(spec.id, "analysis", COMPONENTS.analysis.cost, trx);
      await audit({ actorId: actor.id, action: spec.action, entityType: "resume", entityId: spec.id, ip: meta.ip, data: { source: spec.source, tailored: spec.parentId !== null } }, trx);
      fx.after(() => dispatch({ resumeId: spec.id, userId: actor.id, component: "analysis" }));
    });
  } catch (err) {
    await refundJobs(actor.id, ["analysis"]);
    if (stored && spec.file) await storage().delete(spec.file.key).catch((e) => captureError(e, { where: "resume.cleanup" }));
    throw err;
  }
  // Re-read: in JOBS_MODE=inline the pipeline has already run by now.
  const row = await resumeRepo.findOwned(spec.id, actor.id);
  return toSummary(row!);
}

const optionalText = (v: string | undefined | null, max: number, field: string): string | null => {
  const s = (v ?? "").split("\u0000").join("").trim();
  if (s.length > max) throw badRequest(`${field} is too long (at most ${max} characters)`, "VALIDATION_FAILED");
  return s || null;
};

function templateOrDefault(v: string | undefined | null): TemplateId {
  if (!v) return asTemplateId(null);
  const id = asTemplateId(v);
  if (id !== v) throw badRequest("Unknown template", "UNKNOWN_TEMPLATE");
  return id;
}

function titleFromFile(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled resume").slice(0, 120);
}

export async function createFromUpload(actor: Actor, form: { file: UploadedFile | null; fields: Record<string, string> }, meta: RequestMeta): Promise<ResumeSummary> {
  requireActive(actor);
  if (!form.file || form.file.buffer.length === 0) throw badRequest("Attach your resume as the \"file\" field", "FILE_REQUIRED");
  const jd = optionalText(form.fields.jd, MAX_JD_CHARS, "jd");
  const company = optionalText(form.fields.company, 120, "company");
  const title = optionalText(form.fields.title, 120, "title");
  const templateId = templateOrDefault(form.fields.templateId);
  const kind: FileKind | null = sniffFile(form.file.buffer, form.file.fileName);
  if (!kind) throw new HttpError(415, "Upload a PDF, DOCX, TXT or MD file", "UNSUPPORTED_FILE");
  try {
    await extractText(form.file.buffer, kind); // refuse unreadable and scanned files before any run is charged
  } catch (err) {
    if (err instanceof ExtractError) throw unprocessable(err.message, err.code);
    throw err;
  }
  const id = newId();
  return startResume(
    actor,
    {
      id,
      source: "upload",
      title: title ?? titleFromFile(form.file.fileName),
      file: { key: `resumes/${actor.id}/${id}/original.${kind.ext}`, name: form.file.fileName, mime: kind.mime, body: form.file.buffer },
      original: null,
      jd,
      company,
      templateId,
      parentId: null,
      action: "resume.create",
    },
    meta,
  );
}

export async function createFromDocument(
  actor: Actor,
  input: { document: ResumeDocument; templateId?: TemplateId; jd?: string; company?: string; title?: string },
  meta: RequestMeta,
): Promise<ResumeSummary> {
  requireActive(actor);
  if (isEmptyDocument(input.document)) throw unprocessable("Add some content to the resume first", "EMPTY_DOCUMENT");
  return startResume(
    actor,
    {
      id: newId(),
      source: "builder",
      title: input.title?.trim() || input.document.personal?.fullName?.trim() || "Untitled resume",
      original: input.document,
      jd: optionalText(input.jd, MAX_JD_CHARS, "jd"),
      company: optionalText(input.company, 120, "company"),
      templateId: templateOrDefault(input.templateId),
      parentId: null,
      action: "resume.create",
    },
    meta,
  );
}

export async function tailor(actor: Actor, id: string, input: { jd: string; company?: string }, meta: RequestMeta): Promise<ResumeSummary> {
  requireActive(actor);
  const parent = await resumeRepo.findOwned(id, actor.id);
  if (!parent) throw notFound("Resume not found");
  const jd = optionalText(input.jd, MAX_JD_CHARS, "jd");
  if (!jd) throw badRequest("Paste the job description to tailor for", "VALIDATION_FAILED");
  const company = optionalText(input.company, 120, "company");
  const newResumeId = newId();
  let file: StartSpec["file"];
  if (parent.file_key) {
    const body = await storage()
      .get(parent.file_key)
      .catch(() => {
        throw conflict("The original file is no longer available; upload the resume again", "FILE_MISSING");
      });
    const ext = parent.file_key.split(".").pop() ?? "bin";
    file = { key: `resumes/${actor.id}/${newResumeId}/original.${ext}`, name: parent.file_name ?? `resume.${ext}`, mime: parent.file_mime ?? "application/octet-stream", body };
  }
  return startResume(
    actor,
    {
      id: newResumeId,
      source: parent.source,
      title: `${parent.title.replace(/ \(tailored.*\)$/, "")} (tailored${company ? ` for ${company}` : ""})`.slice(0, 120),
      ...(file ? { file } : {}),
      original: (parent.original as ResumeDocument | null) ?? null,
      jd,
      company,
      templateId: asTemplateId(parent.template_id),
      parentId: parent.id,
      action: "resume.tailor",
    },
    meta,
  );
}

// ─── Read ───────────────────────────────────────────────────────────────────

/** Components stuck "processing" for far too long are failed and refunded, whoever reads first. */
async function reap(row: Pick<ResumeRow, "id" | "user_id">): Promise<void> {
  const reaped = await resumeComponentRepo.reapStale(row.id);
  if (!reaped.length) return;
  await syncStatus(row.id);
  for (const r of reaped) {
    if (r.charged > 0) {
      const job = jobFor(r.kind);
      await refundRuns(row.user_id, r.charged, COMPONENTS[job].chargeKind).catch((err) => captureError(err, { where: "resume.refund" }));
    }
  }
}

export async function list(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<ResumeSummary>> {
  requireActor(actor);
  const limit = q.limit ?? 20;
  const page = timePage(await resumeRepo.list(actor.id, { cursor: decodeTime(q.cursor), limit }), limit);
  return { items: page.items.map(toSummary), nextCursor: page.nextCursor };
}

export async function get(actor: Actor, id: string): Promise<ResumeDetail> {
  requireActor(actor);
  const first = await resumeRepo.findOwned(id, actor.id);
  if (!first) throw notFound("Resume not found");
  await reap(first);
  const row = (await resumeRepo.findOwned(id, actor.id)) ?? first;
  return toDetail(row, await resumeComponentRepo.list(id));
}

export async function status(actor: Actor, id: string): Promise<ResumeStatusView> {
  requireActor(actor);
  const first = await resumeRepo.findOwned(id, actor.id);
  if (!first) throw notFound("Resume not found");
  await reap(first);
  const row = (await resumeRepo.findOwned(id, actor.id)) ?? first;
  return toStatusView(row, await resumeComponentRepo.list(id));
}

// ─── Run more work ──────────────────────────────────────────────────────────

/** Charge and queue `jobs` on a resume. Jobs that turn out to be running already are refunded and reported. */
async function queueJobs(actor: Actor, resume: ResumeRow, jobs: ResumeJobComponent[]): Promise<ResumeJobComponent[]> {
  await assertRuns(actor.id, jobs.reduce((a, j) => a + COMPONENTS[j].cost, 0));
  await chargeJobs(actor.id, jobs);
  let accepted: ResumeJobComponent[];
  try {
    accepted = await withTransaction(async (trx, fx) => {
      const ok: ResumeJobComponent[] = [];
      for (const job of jobs) {
        if (await requestJob(resume.id, job, COMPONENTS[job].cost, trx)) {
          ok.push(job);
          fx.after(() => dispatch({ resumeId: resume.id, userId: actor.id, component: job }));
        }
      }
      await syncStatus(resume.id, trx);
      return ok;
    });
  } catch (err) {
    await refundJobs(actor.id, jobs);
    throw err;
  }
  await refundJobs(actor.id, jobs.filter((j) => !accepted.includes(j)));
  return accepted;
}

export async function retry(actor: Actor, id: string, component: ComponentKind | undefined): Promise<ResumeSummary> {
  requireActive(actor);
  const resume = await resumeRepo.findOwned(id, actor.id);
  if (!resume) throw notFound("Resume not found");
  await reap(resume);
  const comps = await resumeComponentRepo.list(id);
  const failed = new Set(comps.filter((c) => c.status === "failed").map((c) => jobFor(c.kind)));
  let jobs: ResumeJobComponent[];
  if (component) {
    const job = jobFor(component);
    if (!failed.has(job)) throw conflict("Only a step that failed can be retried", "NOT_FAILED");
    jobs = [job];
  } else {
    jobs = [...failed];
    if (jobs.length === 0) throw conflict("Nothing failed on this resume", "NOTHING_TO_RETRY");
  }
  // Extra components work from the analysed resume; retry the analysis first when both failed.
  if (jobs.includes("analysis")) jobs = ["analysis"];
  const accepted = await queueJobs(actor, resume, jobs);
  if (accepted.length === 0) throw conflict("That step is already running", "ALREADY_RUNNING");
  return toSummary((await resumeRepo.findOwned(id, actor.id))!);
}

export async function generateComponent(actor: Actor, id: string, kind: string): Promise<ResumeSummary> {
  requireActive(actor);
  if (!(ON_DEMAND_KINDS as readonly string[]).includes(kind)) throw badRequest("Unknown component", "UNKNOWN_COMPONENT");
  const resume = await resumeRepo.findOwned(id, actor.id);
  if (!resume) throw notFound("Resume not found");
  if (!resume.improved && !resume.original) throw conflict("This resume has not been analysed yet", "NOT_READY");
  await reap(resume);
  const running = (await resumeComponentRepo.list(id)).find((c) => c.kind === kind && c.status === "processing");
  if (running) throw conflict("That is already being generated", "ALREADY_RUNNING");
  const accepted = await queueJobs(actor, resume, [kind as OnDemandKind]);
  if (accepted.length === 0) throw conflict("That is already being generated", "ALREADY_RUNNING");
  return toSummary((await resumeRepo.findOwned(id, actor.id))!);
}

// ─── Delete ─────────────────────────────────────────────────────────────────

export async function remove(actor: Actor, id: string, meta: RequestMeta): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const row = await resumeRepo.deleteOwned(id, actor.id, trx);
    if (!row) throw notFound("Resume not found");
    await audit({ actorId: actor.id, action: "resume.delete", entityType: "resume", entityId: id, ip: meta.ip }, trx);
    // After the commit: a rolled-back delete must not lose the file.
    if (row.file_key) {
      const key = row.file_key;
      fx.after(() => storage().delete(key));
    }
  });
}

// ─── Download and render ────────────────────────────────────────────────────

export const DOWNLOAD_KINDS: readonly DownloadKind[] = ["original", "resume.pdf", "resume.docx", "cover-letter.pdf", "cover-letter.docx"];

export interface FileResponse {
  fileName: string;
  contentType: string;
  body: Buffer;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function slug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "resume"
  );
}

export async function download(actor: Actor, id: string, what: string, templateQuery?: string): Promise<FileResponse> {
  requireActor(actor);
  if (!(DOWNLOAD_KINDS as readonly string[]).includes(what)) throw notFound("Unknown download");
  const resume = await resumeRepo.findOwned(id, actor.id);
  if (!resume) throw notFound("Resume not found");
  const renderer = resumeRendererDep();

  if (what === "original") {
    if (!resume.file_key) throw notFound("This resume was built here and has no uploaded file");
    const body = await storage()
      .get(resume.file_key)
      .catch(() => {
        throw notFound("The original file is no longer available");
      });
    return { fileName: resume.file_name ?? "resume", contentType: resume.file_mime ?? "application/octet-stream", body };
  }

  const document = ((resume.improved ?? resume.original) as ResumeDocument | null) ?? null;
  if (what.startsWith("resume.")) {
    const doc = (resume.improved as ResumeDocument | null) ?? (resume.source === "builder" ? (resume.original as ResumeDocument | null) : null);
    if (!doc) throw conflict("The improved resume is not ready yet", "NOT_READY");
    const template = renderer.resolveTemplate(templateQuery ?? resume.template_id);
    return what === "resume.pdf"
      ? { fileName: `${slug(resume.title)}.pdf`, contentType: "application/pdf", body: await renderPdfOr503(renderer, doc, template) }
      : { fileName: `${slug(resume.title)}.docx`, contentType: DOCX_MIME, body: await renderer.renderDocx(doc, template) };
  }
  const letter = resume.cover_letter as import("@open-resume/types").CoverLetter | null;
  if (!letter || !document) throw conflict("The cover letter is not ready yet", "NOT_READY");
  return what === "cover-letter.pdf"
    ? { fileName: `${slug(resume.title)}-cover-letter.pdf`, contentType: "application/pdf", body: await renderer.renderCoverLetterPdf(letter, document) }
    : { fileName: `${slug(resume.title)}-cover-letter.docx`, contentType: DOCX_MIME, body: await renderer.renderCoverLetterDocx(letter, document) };
}

export async function renderHtml(actor: Actor, id: string, templateQuery?: string): Promise<string> {
  requireActor(actor);
  const resume = await resumeRepo.findOwned(id, actor.id);
  if (!resume) throw notFound("Resume not found");
  const doc = ((resume.improved ?? (resume.source === "builder" ? resume.original : null)) as ResumeDocument | null) ?? null;
  if (!doc) throw conflict("The improved resume is not ready yet", "NOT_READY");
  const renderer = resumeRendererDep();
  return renderer.renderHtml(doc, renderer.resolveTemplate(templateQuery ?? resume.template_id));
}
