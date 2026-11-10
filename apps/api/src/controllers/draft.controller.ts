/** Builder drafts. Thin controllers over services/resume/draft.service. */
import { TEMPLATE_IDS } from "@open-resume/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import { documentSchema } from "../services/resume/document";
import * as svc from "../services/resume/draft.service";

const name = z.string().max(200);
const template = z.enum(TEMPLATE_IDS);

export async function list(req: Request, res: Response) {
  res.json(await svc.list(actorOf(req), parse(pageQuery.extend({ limit: z.coerce.number().int().min(1).max(svc.DRAFT_CAP).optional() }), req.query)));
}

export async function create(req: Request, res: Response) {
  const body = parse(z.object({ name: name.optional(), templateId: template.optional(), document: documentSchema }), req.body);
  res.status(201).json(await svc.create(actorOf(req), body));
}

export async function detail(req: Request, res: Response) {
  res.json(await svc.get(actorOf(req), parse(idParam, req.params).id));
}

export async function update(req: Request, res: Response) {
  const body = parse(z.object({ name: name.optional(), templateId: template.optional(), document: documentSchema.optional() }), req.body);
  res.json(await svc.update(actorOf(req), parse(idParam, req.params).id, body));
}

export async function remove(req: Request, res: Response) {
  await svc.remove(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}
