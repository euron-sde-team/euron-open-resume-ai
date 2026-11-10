/**
 * Monthly AI runs (services/quota.service.ts): tiers, overrides, atomic charging, the
 * resume cap and what is recorded.
 */
import type { Usage } from "@open-resume/types";
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { assertResumeSlot, assertRunsLeft, chargeRuns, limitsFor, QuotaExceededError, refundRuns, usageOf } from "../../src/services/quota.service";
import { as, createUser, type TestUser } from "./harness";

async function override(user: TestUser, values: { monthly_runs?: number | null; max_resumes?: number | null; max_upload_mb?: number | null }) {
  await db.insertInto("user_quota_overrides").values({ user_id: user.id, ...values }).onConflict((oc) => oc.column("user_id").doUpdateSet(values)).execute();
}

describe("limits", () => {
  test("a new user gets the seeded default tier: 20 runs, 10 resumes, 10 MB", async () => {
    const ada = await createUser();
    expect(await limitsFor(ada.id)).toEqual({ monthlyRuns: 20, maxResumes: 10, maxUploadMb: 10 });
    const usage = (await as(ada).get("/api/me/usage").expect(200)).body as Usage;
    expect(usage).toMatchObject({ runs: { used: 0, limit: 20 }, byKind: {} });
    expect(usage.month).toMatch(/^\d{4}-\d{2}$/);
    expect(new Date(usage.resetsAt).getUTCDate()).toBe(1);
  });

  test("a tier sets the limits; an override wins field by field; a null override field falls back to the tier", async () => {
    const tier = newId();
    await db.insertInto("quota_tiers").values({ id: tier, name: `Pro ${tier}`, monthly_runs: 500, max_resumes: 40, max_upload_mb: 25 }).execute();
    const ada = await createUser();
    await db.updateTable("users").set({ quota_tier_id: tier }).where("id", "=", ada.id).execute();
    expect(await limitsFor(ada.id)).toEqual({ monthlyRuns: 500, maxResumes: 40, maxUploadMb: 25 });
    await override(ada, { monthly_runs: 5, max_resumes: null, max_upload_mb: 2 });
    expect(await limitsFor(ada.id)).toEqual({ monthlyRuns: 5, maxResumes: 40, maxUploadMb: 2 });
    await db.updateTable("users").set({ quota_tier_id: null }).where("id", "=", ada.id).execute();
    await db.deleteFrom("quota_tiers").where("id", "=", tier).execute();
  });

  test("an unlimited tier (null) never refuses", async () => {
    const ada = await createUser();
    await override(ada, { monthly_runs: null });
    // The override NULL falls back to the default tier, so use a tier with NULL runs.
    const tier = newId();
    await db.insertInto("quota_tiers").values({ id: tier, name: `Open ${tier}`, monthly_runs: null, max_resumes: null, max_upload_mb: null }).execute();
    await db.updateTable("users").set({ quota_tier_id: tier }).where("id", "=", ada.id).execute();
    expect(await limitsFor(ada.id)).toEqual({ monthlyRuns: null, maxResumes: null, maxUploadMb: null });
    await chargeRuns(ada.id, 1000, "improve");
    await assertRunsLeft(ada.id, 1000);
    await assertResumeSlot(ada.id, 10_000);
    await db.updateTable("users").set({ quota_tier_id: null }).where("id", "=", ada.id).execute();
    await db.deleteFrom("quota_tiers").where("id", "=", tier).execute();
  });
});

describe("charging", () => {
  test("chargeRuns adds to the month by kind and /api/me/usage shows it", async () => {
    const ada = await createUser();
    await chargeRuns(ada.id, 2, "analyze");
    await chargeRuns(ada.id, 1, "improve");
    await chargeRuns(ada.id, 1, "analyze");
    const usage = await usageOf(ada.id);
    expect(usage.runs).toMatchObject({ used: 4, limit: 20 });
    expect(usage.byKind).toEqual({ analyze: 3, improve: 1 });
    expect(((await as(ada).get("/api/me/usage").expect(200)).body as Usage).runs.used).toBe(4);
  });

  test("the last run is taken once: of 6 parallel charges with 2 runs left, exactly 2 succeed", async () => {
    const ada = await createUser();
    await override(ada, { monthly_runs: 2 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => chargeRuns(ada.id, 1, "analyze")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(QuotaExceededError);
    expect((await usageOf(ada.id)).runs.used).toBe(2);
  });

  test("a charge that would pass the limit changes nothing, and assertRunsLeft agrees", async () => {
    const ada = await createUser();
    await override(ada, { monthly_runs: 3 });
    await chargeRuns(ada.id, 2, "improve");
    await expect(chargeRuns(ada.id, 2, "improve")).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(assertRunsLeft(ada.id, 2)).rejects.toBeInstanceOf(QuotaExceededError);
    await assertRunsLeft(ada.id, 1);
    expect((await usageOf(ada.id)).runs.used).toBe(2);
  });

  test("a refund gives runs back but never goes below zero", async () => {
    const ada = await createUser();
    await chargeRuns(ada.id, 3, "cover-letter");
    await refundRuns(ada.id, 2, "cover-letter");
    expect((await usageOf(ada.id)).byKind).toEqual({ "cover-letter": 1 });
    await refundRuns(ada.id, 5, "cover-letter");
    expect((await usageOf(ada.id)).byKind).toEqual({ "cover-letter": 0 });
  });

  test("a previous month does not count against this one", async () => {
    const ada = await createUser();
    await override(ada, { monthly_runs: 1 });
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15));
    await chargeRuns(ada.id, 1, "analyze", lastMonth);
    await chargeRuns(ada.id, 1, "analyze");
    expect((await usageOf(ada.id)).runs.used).toBe(1);
  });

  test("a non-positive or fractional cost is a programming error", async () => {
    const ada = await createUser();
    await expect(chargeRuns(ada.id, 0, "analyze")).rejects.toThrow(RangeError);
    await expect(chargeRuns(ada.id, 1.5, "analyze")).rejects.toThrow(RangeError);
  });

  test("resume slots: at the cap the next one is refused with 429 RESUME_LIMIT", async () => {
    const ada = await createUser();
    await override(ada, { max_resumes: 2 });
    await assertResumeSlot(ada.id, 1);
    await expect(assertResumeSlot(ada.id, 2)).rejects.toMatchObject({ status: 429, code: "RESUME_LIMIT" });
  });
});

describe("what is recorded", () => {
  test("usage_monthly holds counts only: no text column for prompts or resumes", async () => {
    const cols = await db.introspection.getTables().then((t) => t.find((x) => x.name === "usage_monthly")!.columns.map((c) => c.name));
    expect(cols.sort()).toEqual(["kind", "month", "runs", "user_id"]);
  });
});
