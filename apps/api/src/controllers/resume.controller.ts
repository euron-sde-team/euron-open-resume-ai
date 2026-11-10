/** Resume endpoints. Thin: parse the request, call the service, shape the response. */
import type { Request, Response } from "express";
import { z } from "zod";
import { allowedOrigins } from "../core/config";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import { readMultipart } from "../middleware/multipart";
import * as svc from "../services/resume/resume.service";
import { COMPONENT_KINDS, TEMPLATE_IDS } from "@open-resume/types";
import { DOCUMENT_CSP } from "../services/resume/render";
import { documentSchema } from "../services/resume/document";

const template = z.enum(TEMPLATE_IDS);

export async function upload(req: Request, res: Response) {
  const actor = actorOf(req);
  const form = await readMultipart(req, { maxFileBytes: await svc.uploadLimitBytes(actor.id) });
  res.status(202).json(await svc.createFromUpload(actor, form, meta(req)));
}

export async function fromDocument(req: Request, res: Response) {
  const body = parse(
    z.object({
      document: documentSchema,
      templateId: template.optional(),
      jd: z.string().max(svc.MAX_JD_CHARS).optional(),
      company: z.string().max(120).optional(),
      title: z.string().max(120).optional(),
    }),
    req.body,
  );
  res.status(202).json(await svc.createFromDocument(actorOf(req), body, meta(req)));
}

export async function list(req: Request, res: Response) {
  res.json(await svc.list(actorOf(req), parse(pageQuery, req.query)));
}

export async function detail(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await svc.get(actorOf(req), parse(idParam, req.params).id));
}

export async function status(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await svc.status(actorOf(req), parse(idParam, req.params).id));
}

export async function retry(req: Request, res: Response) {
  const body = parse(z.object({ component: z.enum(COMPONENT_KINDS).optional() }), req.body);
  res.status(202).json(await svc.retry(actorOf(req), parse(idParam, req.params).id, body.component));
}

export async function tailor(req: Request, res: Response) {
  const body = parse(z.object({ jd: z.string().min(1).max(svc.MAX_JD_CHARS), company: z.string().max(120).optional() }), req.body);
  res.status(202).json(await svc.tailor(actorOf(req), parse(idParam, req.params).id, body, meta(req)));
}

export async function component(req: Request, res: Response) {
  const p = parse(z.object({ id: id(), kind: z.string().max(40) }), req.params);
  res.status(202).json(await svc.generateComponent(actorOf(req), p.id, p.kind));
}

export async function remove(req: Request, res: Response) {
  await svc.remove(actorOf(req), parse(idParam, req.params).id, meta(req));
  res.status(204).end();
}

/** RFC 6266 attachment header with an ASCII fallback and the real UTF-8 name. */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function download(req: Request, res: Response) {
  const p = parse(z.object({ id: id(), what: z.string().max(40) }), req.params);
  const q = parse(z.object({ template: z.string().max(60).optional() }), req.query);
  const file = await svc.download(actorOf(req), p.id, p.what, q.template);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", attachment(file.fileName));
  res.setHeader("Content-Length", String(file.body.length));
  res.setHeader("Cache-Control", "no-store");
  res.end(file.body);
}

/** Headers for a rendered resume that the web app shows in a sandboxed iframe. */
export function htmlHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [DOCUMENT_CSP, "base-uri 'none'", "form-action 'none'", "sandbox", `frame-ancestors 'self' ${allowedOrigins().join(" ")}`].join("; "),
  );
  // frame-ancestors above replaces X-Frame-Options, which would block the web app's own iframe.
  res.removeHeader("X-Frame-Options");
}

export async function render(req: Request, res: Response) {
  const q = parse(z.object({ template: z.string().max(60).optional() }), req.query);
  const html = await svc.renderHtml(actorOf(req), parse(idParam, req.params).id, q.template);
  htmlHeaders(res);
  res.send(html);
}
