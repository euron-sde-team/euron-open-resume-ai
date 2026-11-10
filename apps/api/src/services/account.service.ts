/**
 * Account lifecycle: deleting your own account (with a grace period), an admin erasing
 * one, and exporting your own data.
 *
 * Delete (DELETE /api/users/me) marks the account `deletion_requested_at` and signs it
 * out everywhere. Signing in again within the grace period cancels the request; after
 * it, the maintenance.purge-accounts job runs `anonymiseUser`. An admin erase (POST
 * /api/admin/users/:id/erase) runs it at once.
 *
 * `anonymiseUser` keeps the users row (usage totals and the audit log point at it) but
 * removes the person and everything they wrote:
 *   - users: status DEACTIVATED, email deleted+<id>@invalid.example, username
 *     deleted-<id tail>, display name "Deleted user", two-factor removed, password
 *     replaced with an unknown one, every session revoked;
 *   - preferences, quota overrides and usage counters are deleted;
 *   - the resume domain adds its own deletes here (resumes, analyses, generated documents
 *     and their stored files): extend `anonymiseUser` and `sections` when you add tables.
 * Being the last active admin blocks deletion (409 LAST_ADMIN).
 *
 * Export (GET /api/users/me/export) streams one JSON document of the caller's own data,
 * read in pages of EXPORT_PAGE rows so a large account never sits in memory at once.
 */
import type { Response } from "express";
import { sql } from "kysely";
import type { Actor, RequestMeta } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { conflict } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { toMe } from "../presenters/user.presenter";
import { resumeDraftsPurge, resumePurge } from "./resume/account-data";
import { recoveryCodeRepo } from "../repositories/recovery-code.repository";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo } from "../repositories/user.repository";
import { hashPassword } from "../security/passwords";
import { randomToken } from "../security/tokens";
import { audit } from "./audit.service";
import { confirmIdentity } from "./auth.service";

export const DELETED_DISPLAY_NAME = "Deleted user";
/** Days between asking to delete an account and the purge. */
export const DELETION_GRACE_DAYS = 14;

export async function assertNotLastAdmin(userId: string, role: string, exec: Executor = db): Promise<void> {
  if (role !== "ADMIN") return;
  const others = await exec.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", userId).executeTakeFirst();
  if (!others) throw conflict("You are the last administrator; make someone else an admin first", "LAST_ADMIN");
}

/** Ask for deletion: signed out everywhere now, erased after the grace period. */
export async function requestDeletion(actor: Actor, input: { password: string; totp?: string; recoveryCode?: string }, meta: RequestMeta): Promise<{ purgeAfter: string }> {
  const user = await confirmIdentity(actor, input);
  await assertNotLastAdmin(user.id, user.role);
  const now = new Date();
  await withTransaction(async (trx) => {
    await trx.updateTable("users").set({ deletion_requested_at: now, updated_at: now }).where("id", "=", user.id).execute();
    await sessionRepo.revokeAllForUser(user.id, trx);
    await userRepo.bumpTokenVersion(user.id, trx);
    await audit({ actorId: user.id, action: "user.deletion_requested", entityType: "user", entityId: user.id, ip: meta.ip }, trx);
  });
  return { purgeAfter: new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000).toISOString() };
}

/** Signing in during the grace period keeps the account. Called by auth.service on a successful login. */
export async function cancelDeletionOnSignIn(userId: string, exec: Executor = db): Promise<boolean> {
  const r = await exec.updateTable("users").set({ deletion_requested_at: null }).where("id", "=", userId).where("deletion_requested_at", "is not", null).executeTakeFirst();
  const cancelled = Number(r.numUpdatedRows) > 0;
  if (cancelled) await audit({ actorId: userId, action: "user.deletion_cancelled", entityType: "user", entityId: userId }, exec);
  return cancelled;
}

/** Strip everything that identifies a person (see the header). Runs inside the caller's transaction. */
export async function anonymiseUser(id: string, trx: Executor, fx?: Effects): Promise<void> {
  const now = new Date();
  const unusable = await hashPassword(randomToken());
  await trx
    .updateTable("users")
    .set({
      status: "DEACTIVATED",
      role: "USER",
      email: `deleted+${id.toLowerCase()}@invalid.example`,
      username: `deleted-${id.slice(-12).toLowerCase()}`,
      display_name: DELETED_DISPLAY_NAME,
      quota_tier_id: null,
      password_hash: unusable,
      totp_enabled: false,
      totp_secret: null,
      totp_last_step: null,
      suspended_until: null,
      deletion_requested_at: null,
      updated_at: now,
    })
    .where("id", "=", id)
    .execute();
  await recoveryCodeRepo.deleteAll(id, trx);
  await trx.deleteFrom("auth_tokens").where("user_id", "=", id).execute();
  await sessionRepo.revokeAllForUser(id, trx);
  await userRepo.bumpTokenVersion(id, trx);

  await trx.deleteFrom("user_preferences").where("user_id", "=", id).execute();
  await trx.deleteFrom("user_quota_overrides").where("user_id", "=", id).execute();
  await trx.deleteFrom("usage_monthly").where("user_id", "=", id).execute();
  // Resume domain: rows go in this transaction, the stored files after it commits.
  await resumeDraftsPurge(id, trx);
  await resumePurge(id, trx, fx);
}

// ─── Export ─────────────────────────────────────────────────────────────────

const EXPORT_PAGE = 500;

type Section = { name: string; query: (after: string | null) => Promise<{ id: string }[]> };

/** The user-owned tables the export streams, one JSON array each, paged by id. */
function sections(userId: string): Section[] {
  const after = (cursor: string | null) => sql<boolean>`${cursor === null ? sql`true` : sql`r.id > ${cursor}`}`;
  return [
    {
      name: "resumes",
      // The row without its storage key, with its components (generated results) nested.
      query: async (cursor) =>
        (
          await sql<{ id: string }>`
            select r.id, r.title, r.source, r.status, r.file_name, r.file_mime, r.file_size, r.jd, r.company, r.is_tailored, r.parent_id,
                   r.template_id, r.original, r.improved, r.analysis, r.cover_letter, r.score, r.created_at, r.updated_at,
                   coalesce((select json_agg(json_build_object('kind', c.kind, 'status', c.status, 'data', c.data, 'updatedAt', c.updated_at) order by c.kind)
                             from resume_components c where c.resume_id = r.id), '[]'::json) as components
            from resumes r
            where r.user_id = ${userId} and ${after(cursor)}
            order by r.id limit ${EXPORT_PAGE}`.execute(db)
        ).rows,
    },
    {
      name: "drafts",
      query: async (cursor) =>
        (
          await sql<{ id: string }>`
            select r.id, r.name, r.template_id, r.document, r.created_at, r.updated_at
            from resume_drafts r
            where r.user_id = ${userId} and ${after(cursor)}
            order by r.id limit ${EXPORT_PAGE}`.execute(db)
        ).rows,
    },
  ];
}

/** Stream the caller's data as one JSON document: { exportedAt, account, preferences, conversations: [...], ... }. */
export async function exportAccount(actor: Actor, res: Response): Promise<void> {
  const user = await userRepo.findById(actor.id);
  if (!user) return void res.status(404).end();
  const account = { ...(await toMe(user)), createdAt: user.created_at.toISOString() };
  const prefs = await db.selectFrom("user_preferences").select(["default_template"]).where("user_id", "=", user.id).executeTakeFirst();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${user.username}-export.json"`);
  res.setHeader("Cache-Control", "no-store");
  const write = (chunk: string) => new Promise<void>((resolve) => (res.write(chunk) ? resolve() : res.once("drain", resolve)));
  await write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"account":${JSON.stringify(account)},"preferences":${JSON.stringify(prefs ?? null)}`);
  for (const section of sections(user.id)) {
    await write(`,${JSON.stringify(section.name)}:[`);
    let cursor: string | null = null;
    let first = true;
    for (;;) {
      const rows = await section.query(cursor);
      for (const row of rows) {
        await write(`${first ? "" : ","}${JSON.stringify(row)}`);
        first = false;
      }
      if (rows.length < EXPORT_PAGE) break;
      cursor = rows[rows.length - 1]!.id;
    }
    await write("]");
  }
  await write("}");
  res.end();
  await audit({ actorId: user.id, action: "user.export", entityType: "user", entityId: user.id });
}
