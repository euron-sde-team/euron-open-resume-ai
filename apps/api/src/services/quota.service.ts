/**
 * Monthly AI run allowances, from the user's quota tier (or the default tier) with an
 * optional per-user override on top. There is no billing: admins decide who gets how much.
 * NULL in a tier or override means unlimited.
 *
 * Counting
 *   usage_monthly in Postgres is the only counter: one row per (user, UTC month, kind).
 *   assertRunsLeft is a cheap pre-check that gives a clean 429 before any work is queued.
 *   chargeRuns is the authority: inside one transaction it takes a per-user advisory lock,
 *   re-reads the month's total and the limits, and adds the cost only when the result stays
 *   within the limit. Two parallel requests can therefore never both take the last run.
 *   Refund a charge with refundRuns when the work could not start or failed on our side.
 */
import type { QuotaLimits, Usage } from "@open-resume/types";
import { sql } from "kysely";
import { tooMany } from "../core/errors";
import { db, type Executor } from "../db/kysely";

export type Limits = QuotaLimits;

export const QUOTA_EXCEEDED = "QUOTA_EXCEEDED";

/** The UTC month, "2026-11". */
export function utcMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** First moment of the next UTC month. */
export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const n = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** The tier (or the default tier) with the user's override applied, field by field. */
export async function limitsFor(userId: string, exec: Executor = db): Promise<Limits> {
  const row = await exec
    .selectFrom("users as u")
    .leftJoin("quota_tiers as t", "t.id", "u.quota_tier_id")
    .leftJoin("quota_tiers as d", (j) => j.on("d.is_default", "=", true))
    .leftJoin("user_quota_overrides as o", "o.user_id", "u.id")
    .select([
      "t.id as tier_id",
      "t.monthly_runs as t_runs",
      "t.max_resumes as t_resumes",
      "t.max_upload_mb as t_mb",
      "d.monthly_runs as d_runs",
      "d.max_resumes as d_resumes",
      "d.max_upload_mb as d_mb",
      "o.user_id as o_user",
      "o.monthly_runs as o_runs",
      "o.max_resumes as o_resumes",
      "o.max_upload_mb as o_mb",
    ])
    .where("u.id", "=", userId)
    .executeTakeFirst();
  // An unknown user gets nothing rather than the default allowance.
  if (!row) return { monthlyRuns: 0, maxResumes: 0, maxUploadMb: 1 };
  const onTier = row.tier_id !== null;
  const has = row.o_user !== null;
  return {
    monthlyRuns: has && row.o_runs !== null ? n(row.o_runs) : n(onTier ? row.t_runs : row.d_runs),
    maxResumes: has && row.o_resumes !== null ? n(row.o_resumes) : n(onTier ? row.t_resumes : row.d_resumes),
    maxUploadMb: has && row.o_mb !== null ? n(row.o_mb) : n(onTier ? row.t_mb : row.d_mb),
  };
}

function monthDate(month: string) {
  return sql<Date>`${month + "-01"}::date`;
}

/** Runs used in a UTC month (default: the current one), all kinds. */
export async function runsUsed(userId: string, month = utcMonth(), exec: Executor = db): Promise<number> {
  const row = await exec
    .selectFrom("usage_monthly")
    .select(sql<number>`coalesce(sum(runs), 0)`.as("n"))
    .where("user_id", "=", userId)
    .where("month", "=", monthDate(month))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** The quota tier the user is on: their own, else the default; null when there is neither. */
async function tierOf(userId: string, exec: Executor): Promise<{ id: string; name: string } | null> {
  const own = await exec
    .selectFrom("users as u")
    .innerJoin("quota_tiers as t", "t.id", "u.quota_tier_id")
    .select(["t.id", "t.name"])
    .where("u.id", "=", userId)
    .executeTakeFirst();
  if (own) return own;
  return (await exec.selectFrom("quota_tiers").select(["id", "name"]).where("is_default", "=", true).executeTakeFirst()) ?? null;
}

/** This month's use against the allowance, the resumes held and the tier. */
export async function usageOf(userId: string, now = new Date()): Promise<Usage> {
  const month = utcMonth(now);
  const [limits, rows, held, tier] = await Promise.all([
    limitsFor(userId),
    db.selectFrom("usage_monthly").select(["kind", "runs"]).where("user_id", "=", userId).where("month", "=", monthDate(month)).execute(),
    db
      .selectFrom("resumes")
      .select(sql<number>`count(*)`.as("n"))
      .where("user_id", "=", userId)
      .executeTakeFirst(),
    tierOf(userId, db),
  ]);
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, Number(r.runs)]));
  const resetsAt = nextMonthStart(now).toISOString();
  return {
    month,
    runs: { used: rows.reduce((a, r) => a + Number(r.runs), 0), limit: limits.monthlyRuns, resetsAt },
    resumes: { count: Number(held?.n ?? 0), limit: limits.maxResumes },
    maxUploadMb: limits.maxUploadMb,
    tier,
    byKind,
    limits,
    resetsAt,
  };
}

/** A month-by-month history, newest first (admin user detail). */
export async function usageByMonth(userId: string, months = 6, exec: Executor = db): Promise<{ month: string; runs: number }[]> {
  const rows = await exec
    .selectFrom("usage_monthly")
    .select([sql<string>`to_char(month, 'YYYY-MM')`.as("month"), sql<number>`sum(runs)`.as("runs")])
    .where("user_id", "=", userId)
    .groupBy("month")
    .orderBy("month", "desc")
    .limit(months)
    .execute();
  return rows.map((r) => ({ month: r.month, runs: Number(r.runs) }));
}

export class QuotaExceededError extends Error {
  readonly code = QUOTA_EXCEEDED;
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super("You have used this month's AI runs");
  }
}

/** As an HTTP error (429 QUOTA_EXCEEDED). */
export function quotaHttpError(err: QuotaExceededError) {
  return Object.assign(tooMany(err.message), { code: QUOTA_EXCEEDED as typeof QUOTA_EXCEEDED });
}

/** Throws QuotaExceededError when `cost` more runs would pass this month's limit. A pre-check only: chargeRuns decides. */
export async function assertRunsLeft(userId: string, cost = 1): Promise<void> {
  const { monthlyRuns } = await limitsFor(userId);
  if (monthlyRuns === null) return;
  const used = await runsUsed(userId);
  if (used + cost > monthlyRuns) throw new QuotaExceededError(used, monthlyRuns);
}

/**
 * Atomically charge `cost` runs to this month under `kind`, or throw QuotaExceededError
 * without changing anything. Safe under concurrency and across API tasks.
 */
export async function chargeRuns(userId: string, cost: number, kind: string, now = new Date()): Promise<void> {
  if (!Number.isInteger(cost) || cost < 1) throw new RangeError("cost must be a positive integer");
  const month = utcMonth(now);
  await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${"quota:" + userId}))`.execute(trx);
    const { monthlyRuns } = await limitsFor(userId, trx);
    if (monthlyRuns !== null) {
      const used = await runsUsed(userId, month, trx);
      if (used + cost > monthlyRuns) throw new QuotaExceededError(used, monthlyRuns);
    }
    await trx
      .insertInto("usage_monthly")
      .values({ user_id: userId, month: monthDate(month), kind, runs: cost })
      .onConflict((oc) => oc.columns(["user_id", "month", "kind"]).doUpdateSet((eb) => ({ runs: eb("usage_monthly.runs", "+", cost) })))
      .execute();
  });
}

/** Give back runs charged for work that failed on our side (never below zero). */
export async function refundRuns(userId: string, cost: number, kind: string, now = new Date()): Promise<void> {
  await db
    .updateTable("usage_monthly")
    .set({ runs: sql`greatest(runs - ${cost}, 0)` })
    .where("user_id", "=", userId)
    .where("month", "=", monthDate(utcMonth(now)))
    .where("kind", "=", kind)
    .execute();
}

/** Whether the user may create one more resume given how many they hold. */
export async function assertResumeSlot(userId: string, currentCount: number): Promise<void> {
  const { maxResumes } = await limitsFor(userId);
  if (maxResumes !== null && currentCount >= maxResumes) {
    throw Object.assign(tooMany(`You can keep up to ${maxResumes} resumes`), { code: "RESUME_LIMIT" as const });
  }
}
