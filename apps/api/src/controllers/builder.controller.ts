/** Builder rendering: the template list, live HTML preview and PDF/DOCX export. Thin controllers. */
import type { Request, Response } from "express";
import { z } from "zod";
import { TEMPLATE_IDS } from "@open-resume/types";
import { HttpError } from "../core/errors";
import { parse } from "../core/validate";
import { DOCUMENT_CSP, PdfUnavailableError, resumeRenderer } from "../services/resume/render";
import { documentSchema } from "../services/resume/document";

/** Largest accepted request body for the render and export endpoints. */
export const BUILDER_BODY_LIMIT_BYTES = 512 * 1024;

const templateId = z.enum(TEMPLATE_IDS);
const renderBody = z.object({ document: documentSchema, templateId }).strict();
const exportBody = z.object({ document: documentSchema, templateId, format: z.enum(["pdf", "docx"]) }).strict();

/** 413 for an oversized body, before any rendering work. */
export function bodyCap(req: Request, _res: Response, next: () => void): void {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > BUILDER_BODY_LIMIT_BYTES) throw new HttpError(413, "The document is too large to render", "PAYLOAD_TOO_LARGE");
  next();
}

export function listTemplates(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, max-age=300");
  res.json(resumeRenderer.listTemplates());
}

export async function render(req: Request, res: Response) {
  const body = parse(renderBody, req.body);
  const html = await resumeRenderer.renderHtml(body.document, body.templateId);
  res.setHeader("Content-Security-Policy", DOCUMENT_CSP);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("text/html; charset=utf-8").send(html);
}

const slug = (s: string | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);

export async function exportDocument(req: Request, res: Response) {
  const body = parse(exportBody, req.body);
  let file: Buffer;
  try {
    file = body.format === "pdf" ? await resumeRenderer.renderPdf(body.document, body.templateId) : await resumeRenderer.renderDocx(body.document, body.templateId);
  } catch (err) {
    if (err instanceof PdfUnavailableError) throw new HttpError(503, "PDF export is not available right now", "PDF_UNAVAILABLE");
    throw err;
  }
  const name = `${slug(body.document.personal?.fullName) || "resume"}.${body.format}`;
  res.setHeader("Content-Type", body.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file);
}
