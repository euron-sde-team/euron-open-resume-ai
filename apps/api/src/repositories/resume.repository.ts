import type { ResumeStatus } from "@open-resume/types";
import { sql, type Insertable, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Resumes } from "../db/types";
import { atKey, olderThan, type TimeKey } from "./keyset";

export type ResumeRow = Selectable<Resumes>;

const SUMMARY_COLUMNS = ["id", "title", "file_name", "source", "status", "score", "company", "is_tailored", "parent_id", "template_id", "created_at", "updated_at"] as const;
export type ResumeSummaryRow = Pick<ResumeRow, (typeof SUMMARY_COLUMNS)[number]> & { _at: string };

export class ResumeRepository {
  insert(row: Insertable<Resumes>, exec: Executor = db) {
    return exec.insertInto("resumes").values(row).returningAll().executeTakeFirstOrThrow();
  }

  /** The caller's resume, or undefined: someone else's id is indistinguishable from a missing one. */
  findOwned(id: string, userId: string, exec: Executor = db) {
    return exec.selectFrom("resumes").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
  }

  /** As findOwned but locks the row for the rest of the transaction. */
  lockOwned(id: string, userId: string, exec: Executor) {
    return exec.selectFrom("resumes").selectAll().where("id", "=", id).where("user_id", "=", userId).forUpdate().executeTakeFirst();
  }

  count(userId: string, exec: Executor = db): Promise<number> {
    return exec
      .selectFrom("resumes")
      .select(sql<number>`count(*)`.as("n"))
      .where("user_id", "=", userId)
      .executeTakeFirst()
      .then((r) => Number(r?.n ?? 0));
  }

  /** Newest-updated first. Asks for one extra row so the caller can build the next cursor. */
  list(userId: string, opts: { cursor: TimeKey | null; limit: number }, exec: Executor = db): Promise<ResumeSummaryRow[]> {
    return exec
      .selectFrom("resumes")
      .select([...SUMMARY_COLUMNS, atKey("updated_at")])
      .where("user_id", "=", userId)
      .where(olderThan("updated_at", "id", opts.cursor))
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(opts.limit + 1)
      .execute() as Promise<ResumeSummaryRow[]>;
  }

  async update(id: string, userId: string, patch: Partial<Omit<ResumeRow, "id" | "user_id" | "created_at">>, exec: Executor = db): Promise<void> {
    await exec
      .updateTable("resumes")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .execute();
  }

  /** Store the derived status; a no-op (and no updated_at bump) when it did not change. */
  setStatus(id: string, status: ResumeStatus, exec: Executor = db) {
    return exec.updateTable("resumes").set({ status, updated_at: new Date() }).where("id", "=", id).where("status", "<>", status).execute();
  }

  /** Delete the caller's resume; returns what is needed to remove its stored file, or undefined if it is not theirs. */
  deleteOwned(id: string, userId: string, exec: Executor) {
    return exec.deleteFrom("resumes").where("id", "=", id).where("user_id", "=", userId).returning(["file_key"]).executeTakeFirst();
  }

  /** Storage keys of every resume a user holds (account purge). */
  async fileKeys(userId: string, exec: Executor = db): Promise<string[]> {
    const rows = await exec.selectFrom("resumes").select("file_key").where("user_id", "=", userId).where("file_key", "is not", null).execute();
    return rows.map((r) => r.file_key!).filter(Boolean);
  }

  async deleteAllForUser(userId: string, exec: Executor): Promise<void> {
    await exec.deleteFrom("resumes").where("user_id", "=", userId).execute();
  }
}

export const resumeRepo = new ResumeRepository();
