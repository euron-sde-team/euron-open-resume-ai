import { sql, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { ResumeDrafts } from "../db/types";
import { atKey, olderThan, type TimeKey } from "./keyset";

export type DraftRow = Selectable<ResumeDrafts>;
export type DraftSummaryRow = Pick<DraftRow, "id" | "name" | "template_id" | "updated_at"> & { _at: string };

export class ResumeDraftRepository {
  list(userId: string, opts: { cursor: TimeKey | null; limit: number }, exec: Executor = db): Promise<DraftSummaryRow[]> {
    return exec
      .selectFrom("resume_drafts")
      .select(["id", "name", "template_id", "updated_at", atKey("updated_at")])
      .where("user_id", "=", userId)
      .where(olderThan("updated_at", "id", opts.cursor))
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(opts.limit + 1)
      .execute() as Promise<DraftSummaryRow[]>;
  }

  count(userId: string, exec: Executor = db): Promise<number> {
    return exec
      .selectFrom("resume_drafts")
      .select(sql<number>`count(*)`.as("n"))
      .where("user_id", "=", userId)
      .executeTakeFirst()
      .then((r) => Number(r?.n ?? 0));
  }

  findOwned(id: string, userId: string, exec: Executor = db) {
    return exec.selectFrom("resume_drafts").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
  }

  insert(row: { id: string; user_id: string; name: string; template_id: string; document: unknown }, exec: Executor = db) {
    return exec
      .insertInto("resume_drafts")
      .values({ ...row, document: JSON.stringify(row.document) })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  update(id: string, userId: string, patch: { name?: string; template_id?: string; document?: unknown }, exec: Executor = db) {
    const { document, ...rest } = patch;
    return exec
      .updateTable("resume_drafts")
      .set({ ...rest, ...(document !== undefined ? { document: JSON.stringify(document) } : {}), updated_at: new Date() })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(id: string, userId: string, exec: Executor = db): Promise<boolean> {
    const r = await exec.deleteFrom("resume_drafts").where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  async deleteAllForUser(userId: string, exec: Executor): Promise<void> {
    await exec.deleteFrom("resume_drafts").where("user_id", "=", userId).execute();
  }
}

export const draftRepo = new ResumeDraftRepository();
