import type { ComponentKind } from "@open-resume/types";
import { sql, type Selectable } from "kysely";
import { STALE_CLAIM_MS, STALE_REQUEST_MS } from "../services/resume/components";
import { db, type Executor } from "../db/kysely";
import type { ResumeComponents } from "../db/types";

export type ComponentDbRow = Selectable<ResumeComponents>;

const ago = (ms: number) => new Date(Date.now() - ms);

export class ResumeComponentRepository {
  list(resumeId: string, exec: Executor = db) {
    return exec.selectFrom("resume_components").selectAll().where("resume_id", "=", resumeId).execute();
  }

  /** Several resumes at once (no N+1 in lists). */
  listFor(resumeIds: string[], exec: Executor = db) {
    if (!resumeIds.length) return Promise.resolve([] as ComponentDbRow[]);
    return exec.selectFrom("resume_components").selectAll().where("resume_id", "in", resumeIds).execute();
  }

  /**
   * Ask for `kind` to run: the row becomes "processing" (queued, not yet claimed) with the
   * runs charged for it. Returns false when it is already queued or running, so a double
   * click can neither run twice nor charge twice.
   */
  async request(resumeId: string, kind: ComponentKind, charged: number, exec: Executor = db): Promise<boolean> {
    const row = await exec
      .insertInto("resume_components")
      .values({ resume_id: resumeId, kind, status: "processing", attempts: 0, charged, claimed_at: null, error: null })
      .onConflict((oc) =>
        oc
          .columns(["resume_id", "kind"])
          .doUpdateSet({ status: "processing", attempts: 0, charged, claimed_at: null, error: null, updated_at: new Date() })
          .where((eb) => eb.or([eb("resume_components.status", "<>", "processing"), eb("resume_components.updated_at", "<", ago(STALE_REQUEST_MS))])),
      )
      .returning("kind")
      .executeTakeFirst();
    return !!row;
  }

  /**
   * A worker takes the job: only a queued row (or one whose claim went stale) can be taken.
   * Returns the attempt number, or null when the job is already done, running elsewhere or gone.
   */
  async claim(resumeId: string, kind: ComponentKind, exec: Executor = db): Promise<number | null> {
    const row = await exec
      .updateTable("resume_components")
      .set({ claimed_at: new Date(), attempts: sql`attempts + 1`, updated_at: new Date() })
      .where("resume_id", "=", resumeId)
      .where("kind", "=", kind)
      .where("status", "=", "processing")
      .where((eb) => eb.or([eb("claimed_at", "is", null), eb("claimed_at", "<", ago(STALE_CLAIM_MS))]))
      .returning("attempts")
      .executeTakeFirst();
    return row ? row.attempts : null;
  }

  /** Mirror a claim onto the rows a job covers besides its own. */
  async touch(resumeId: string, kinds: ComponentKind[], exec: Executor = db): Promise<void> {
    if (!kinds.length) return;
    await exec
      .updateTable("resume_components")
      .set({ claimed_at: new Date(), updated_at: new Date() })
      .where("resume_id", "=", resumeId)
      .where("kind", "in", kinds)
      .where("status", "=", "processing")
      .execute();
  }

  /** Back to queued for another attempt, remembering why the last one failed. */
  async release(resumeId: string, kinds: ComponentKind[], error: string, exec: Executor = db): Promise<void> {
    await exec
      .updateTable("resume_components")
      .set({ claimed_at: null, error, updated_at: new Date() })
      .where("resume_id", "=", resumeId)
      .where("kind", "in", kinds)
      .where("status", "=", "processing")
      .execute();
  }

  async markDone(resumeId: string, kind: ComponentKind, data: unknown | null, exec: Executor = db): Promise<void> {
    await exec
      .updateTable("resume_components")
      .set({ status: "done", error: null, claimed_at: null, data: data === null ? null : JSON.stringify(data), updated_at: new Date() })
      .where("resume_id", "=", resumeId)
      .where("kind", "=", kind)
      .execute();
  }

  /**
   * Final failure of `kinds`: they become "failed" with a user-safe message. Returns the
   * runs that had been charged for them (now zeroed), for the caller to give back.
   */
  async fail(resumeId: string, kinds: ComponentKind[], error: string, exec: Executor): Promise<number> {
    const rows = await exec
      .selectFrom("resume_components")
      .select(["kind", "charged"])
      .where("resume_id", "=", resumeId)
      .where("kind", "in", kinds)
      .forUpdate()
      .execute();
    await exec
      .updateTable("resume_components")
      .set({ status: "failed", error, claimed_at: null, charged: 0, updated_at: new Date() })
      .where("resume_id", "=", resumeId)
      .where("kind", "in", kinds)
      .execute();
    return rows.reduce((a, r) => a + r.charged, 0);
  }

  /** Queued rows that never started go back to "not generated" (their parent job failed). */
  async cancelQueued(resumeId: string, kinds: ComponentKind[], exec: Executor): Promise<void> {
    await exec
      .updateTable("resume_components")
      .set({ status: "pending", error: null, charged: 0, updated_at: new Date() })
      .where("resume_id", "=", resumeId)
      .where("kind", "in", kinds)
      .where("status", "=", "processing")
      .where("claimed_at", "is", null)
      .execute();
  }

  /** Components that lost their job (queued or running far too long), failed in one statement. */
  async reapStale(resumeId: string, exec: Executor = db): Promise<{ kind: ComponentKind; charged: number }[]> {
    const stale = await exec
      .selectFrom("resume_components")
      .select(["kind", "charged"])
      .where("resume_id", "=", resumeId)
      .where("status", "=", "processing")
      .where("updated_at", "<", ago(STALE_REQUEST_MS))
      .execute();
    if (!stale.length) return [];
    // Conditional again so two readers reaping at once refund once.
    const done = await exec
      .updateTable("resume_components")
      .set({ status: "failed", error: "This took too long and was stopped. Please retry.", claimed_at: null, charged: 0, updated_at: new Date() })
      .where("resume_id", "=", resumeId)
      .where("kind", "in", stale.map((s) => s.kind))
      .where("status", "=", "processing")
      .where("updated_at", "<", ago(STALE_REQUEST_MS))
      .returning("kind")
      .execute();
    const reaped = new Set(done.map((d) => d.kind));
    return stale.filter((s) => reaped.has(s.kind));
  }
}

export const resumeComponentRepo = new ResumeComponentRepository();
