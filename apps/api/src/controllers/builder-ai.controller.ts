/**
 * The chat builder's AI routes. Order matters: cheap validation first, then the run is
 * charged BEFORE the model is called, and refunded if the work failed on our side (model
 * unavailable, bad output, client went away). Resume text never reaches a log line.
 */
import type { BuilderChatResponse, ResumeDocument } from "@open-resume/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { badRequest, HttpError } from "../core/errors";
import { parse } from "../core/validate";
import { requireActive } from "../core/context";
import { actorOf } from "../middleware/http";
import { cleanExtracted, extractText, sniffKind } from "../services/resume/ai/extract-text";
import { LIMITS } from "../services/resume/ai/limits";
import { AiBadOutput, AiUnavailable } from "../services/resume/ai/runner";
import { resumeAiTasks } from "../services/resume/ai";
import { assertRunsLeft, chargeRuns, QuotaExceededError, quotaHttpError, refundRuns } from "../services/quota.service";

const KIND = "builder";

const chatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(LIMITS.chatMessageChars) }))
    .min(1)
    .max(60),
  document: z.record(z.unknown()).optional(),
});

/** An AI failure as the HTTP error a client can act on. */
export function aiHttpError(err: unknown): HttpError | null {
  if (err instanceof AiUnavailable) return new HttpError(503, err.message, err.code);
  if (err instanceof AiBadOutput) return new HttpError(502, err.message, err.code);
  return null;
}

/** Charge one run, run the work, refund on our-side failure. */
async function withRun<T>(userId: string, work: () => Promise<T>): Promise<T> {
  try {
    await assertRunsLeft(userId, 1);
    await chargeRuns(userId, 1, KIND);
  } catch (err) {
    if (err instanceof QuotaExceededError) throw quotaHttpError(err);
    throw err;
  }
  try {
    return await work();
  } catch (err) {
    await refundRuns(userId, 1, KIND).catch(() => undefined);
    throw aiHttpError(err) ?? err;
  }
}

/** Aborts when the client disconnects before the answer is sent. */
function clientGone(req: Request, res: Response): AbortSignal {
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });
  req.on("aborted", () => ac.abort());
  return ac.signal;
}

export async function chat(req: Request, res: Response) {
  const user = requireActive(actorOf(req));
  const body = parse(chatBody, req.body);
  if (!body.messages.some((m) => m.role === "user" && m.content.trim())) throw badRequest("Send at least one message.", "VALIDATION_FAILED");
  const signal = clientGone(req, res);
  const out = await withRun(user.id, () => resumeAiTasks.builderChat({ messages: body.messages, document: body.document as ResumeDocument | undefined }, { userId: user.id, signal }));
  res.json(out);
}

/** The multipart body, buffered up to the cap, as a File. */
async function readUpload(req: Request): Promise<{ buf: Buffer; name: string }> {
  const type = req.headers["content-type"] ?? "";
  if (!/^multipart\/form-data;/i.test(type)) throw badRequest("Send the resume as multipart/form-data with a file field.", "VALIDATION_FAILED");
  const cap = LIMITS.importBytes + 64 * 1024;
  const declared = Number(req.headers["content-length"] ?? 0);
  const tooBig = () => new HttpError(413, "That file is larger than 10 MB.", "FILE_TOO_LARGE");
  // Over the cap we still read (and discard) a bounded amount more, so the client sees the 413 and not a broken pipe.
  const drainLimit = 64 * 1024 * 1024;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= cap) chunks.push(chunk as Buffer);
    else if (size > drainLimit) {
      req.destroy();
      throw tooBig();
    }
  }
  if (size > cap || declared > drainLimit) throw tooBig();
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { "content-type": type } }).formData();
  } catch {
    throw badRequest("The upload could not be read.", "VALIDATION_FAILED");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach the resume as the file field.", "VALIDATION_FAILED");
  if (file.size > LIMITS.importBytes) throw new HttpError(413, "That file is larger than 10 MB.", "FILE_TOO_LARGE");
  return { buf: Buffer.from(await file.arrayBuffer()), name: file.name };
}

function describe(doc: ResumeDocument): string {
  const bits = [
    doc.experience?.length ? `${doc.experience.length} job${doc.experience.length > 1 ? "s" : ""}` : "",
    doc.education?.length ? `${doc.education.length} education entr${doc.education.length > 1 ? "ies" : "y"}` : "",
    doc.skills?.length ? `${doc.skills.reduce((a, g) => a + (g.items?.length ?? 0), 0)} skills` : "",
    doc.projects?.length ? `${doc.projects.length} project${doc.projects.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return bits.length ? `I read your resume and found ${bits.join(", ")}.` : "I read your resume.";
}

export async function importResume(req: Request, res: Response) {
  const user = requireActive(actorOf(req));
  const { buf, name } = await readUpload(req);
  const kind = sniffKind(buf, name);
  if (!kind) throw new HttpError(415, "Upload a PDF, DOCX, TXT or Markdown file.", "UNSUPPORTED_FILE");
  const text = cleanExtracted(await extractText(buf, kind));
  const signal = clientGone(req, res);
  const document = await withRun(user.id, () => resumeAiTasks.parseDocument(text, { userId: user.id, signal }));
  const body: Pick<BuilderChatResponse, "assistant" | "document"> = { assistant: `${describe(document)} Check the details and tell me what to change or add.`, document };
  res.json(body);
}
