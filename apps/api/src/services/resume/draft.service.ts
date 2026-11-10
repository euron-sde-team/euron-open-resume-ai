/** Builder drafts: a ResumeDocument being edited, up to 50 per user. */
import type { Page, ResumeDocument, ResumeDraft, ResumeDraftSummary, TemplateId } from "@open-resume/types";
import { sql } from "kysely";
import type { Actor } from "../../core/context";
import { requireActive, requireActor } from "../../core/context";
import { withTransaction } from "../../core/effects";
import { conflict, notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import { toDraft, toDraftSummary } from "../../presenters/resume.presenter";
import { draftRepo } from "../../repositories/resume-draft.repository";
import { decodeTime, timePage } from "../../repositories/keyset";

export const DRAFT_CAP = 50;

export async function list(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<ResumeDraftSummary>> {
  requireActor(actor);
  const limit = q.limit ?? DRAFT_CAP;
  const page = timePage(await draftRepo.list(actor.id, { cursor: decodeTime(q.cursor), limit }), limit);
  return { items: page.items.map(toDraftSummary), nextCursor: page.nextCursor };
}

export async function create(actor: Actor, input: { name?: string; templateId?: TemplateId; document: ResumeDocument }): Promise<ResumeDraft> {
  requireActive(actor);
  const row = await withTransaction(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${"drafts:" + actor.id}))`.execute(trx);
    if ((await draftRepo.count(actor.id, trx)) >= DRAFT_CAP) throw conflict(`You can keep up to ${DRAFT_CAP} drafts. Delete one to add another.`, "DRAFT_LIMIT", { limit: DRAFT_CAP });
    return draftRepo.insert(
      { id: newId(), user_id: actor.id, name: (input.name?.trim() || input.document.personal?.fullName || "Untitled draft").slice(0, 80), template_id: input.templateId ?? "modern_resume_template", document: input.document },
      trx,
    );
  });
  return toDraft(row);
}

export async function get(actor: Actor, id: string): Promise<ResumeDraft> {
  requireActor(actor);
  const row = await draftRepo.findOwned(id, actor.id);
  if (!row) throw notFound("Draft not found");
  return toDraft(row);
}

export async function update(actor: Actor, id: string, patch: { name?: string; templateId?: TemplateId; document?: ResumeDocument }): Promise<ResumeDraft> {
  requireActive(actor);
  const row = await draftRepo.update(id, actor.id, {
    ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || "Untitled draft" } : {}),
    ...(patch.templateId ? { template_id: patch.templateId } : {}),
    ...(patch.document !== undefined ? { document: patch.document } : {}),
  });
  if (!row) throw notFound("Draft not found");
  return toDraft(row);
}

export async function remove(actor: Actor, id: string): Promise<void> {
  requireActive(actor);
  if (!(await draftRepo.delete(id, actor.id))) throw notFound("Draft not found");
}
