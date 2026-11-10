/**
 * The /admin control plane: admins only; accounts (list, detail, role, suspend, ban,
 * erase, tier, override); quota tiers; providers and models (never a key, never provider
 * text); settings (audited); stats; the audit trail. Every test restores any
 * shared state it changes (the default tier, settings, the catalogue).
 */
import type { AdminModel, AdminProvider, AdminStats, AdminUserDetail, AdminUserRow, AuditEntry, AppSettings, IntegrationStatus, ModelTestResult, Page, QuotaTier } from "@open-resume/types";
import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { clearModelCache } from "../../src/services/models.service";
import { CANARY_KEY } from "./env";
import { chargeRuns } from "../../src/services/quota.service";
import { anon, as, createUser, PASSWORD, resetSettings, stubsUrl, type TestUser } from "./harness";

const ADMIN_GETS = ["/api/admin/me", "/api/admin/stats", "/api/admin/users", "/api/admin/tiers", "/api/admin/providers", "/api/admin/models", "/api/admin/settings", "/api/admin/integrations", "/api/admin/audit"];

async function auditFor(admin: TestUser, entityId: string): Promise<AuditEntry[]> {
  return ((await as(admin).get(`/api/admin/audit?entityId=${entityId}`).expect(200)).body as Page<AuditEntry>).items;
}

describe("who may open /admin", () => {
  test("signed out 401, users 403 FORBIDDEN_ADMIN, a suspended admin has no powers, admins 200", async () => {
    const user = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    for (const url of ADMIN_GETS) {
      expect((await anon().get(url)).status, url).toBe(401);
      const res = await as(user).get(url);
      expect([res.status, res.body.code], url).toEqual([403, "FORBIDDEN_ADMIN"]);
      expect((await as(admin).get(url)).status, url).toBe(200);
    }
    expect((await as(user).post("/api/admin/tiers").send({ name: "x", monthlyRuns: 1, maxResumes: 1, maxUploadMb: 1 })).status).toBe(403);
    const suspendedAdmin = await createUser({ role: "ADMIN", status: "SUSPENDED" });
    expect((await as(suspendedAdmin).get("/api/admin/users").expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(admin).get("/api/admin/me").expect(200)).body).toEqual({ role: "ADMIN" });
    expect((await as(user).get("/api/users/me").expect(200)).body.canOpenAdmin).toBe(false);
    expect((await as(admin).get("/api/users/me").expect(200)).body.canOpenAdmin).toBe(true);
  });
});

describe("accounts", () => {
  test("list with search and filters; detail with limits and usage, never resume content", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser({ displayName: "Findable Person" });
    await chargeRuns(ada.id, 3, "analyze");
    const list = (await as(admin).get(`/api/admin/users?q=${ada.username}`).expect(200)).body as Page<AdminUserRow>;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: ada.id, email: ada.email, status: "ACTIVE", role: "USER", quotaTier: null, displayName: "Findable Person" });
    expect(list.items[0]!.runsThisMonth).toBe(3);
    expect(((await as(admin).get("/api/admin/users?role=ADMIN&limit=100").expect(200)).body as Page<AdminUserRow>).items.every((u) => u.role === "ADMIN")).toBe(true);
    // Wildcards match literally.
    expect(((await as(admin).get("/api/admin/users?q=%25%25%25").expect(200)).body as Page<AdminUserRow>).items).toEqual([]);

    const detail = (await as(admin).get(`/api/admin/users/${ada.id}`).expect(200)).body as AdminUserDetail;
    expect(detail.usage).toEqual([{ month: new Date().toISOString().slice(0, 7), runs: 3 }]);
    expect(detail.limits).toEqual({ monthlyRuns: 20, maxResumes: 10, maxUploadMb: 10 });
    expect(detail.override).toBeNull();
    await as(admin).get("/api/admin/users/01ARZ3NDEKTSV4RRFFQ69G5FAV").expect(404);
  });

  test("role change: promote, demote (the demoted token stops working at once), never yourself", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const bob = await createUser();
    await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "ADMIN" }).expect(200);
    expect(((await as(admin).get(`/api/admin/users/${bob.id}`).expect(200)).body as AdminUserDetail).role).toBe("ADMIN");
    await as(bob).get("/api/admin/me").expect(200);
    await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "USER" }).expect(200);
    expect((await as(bob).get("/api/admin/me").expect(401)).body.code).toBe("TOKEN_INVALID");
    expect((await as(admin).patch(`/api/admin/users/${admin.id}/role`).send({ role: "USER" }).expect(403)).body.code).toBe("SELF_ACTION");
    await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "OWNER" }).expect(400);
    const entries = await auditFor(admin, bob.id);
    expect(entries.map((e) => e.action)).toEqual(["user.role", "user.role"]);
    expect(entries[0]!.data).toEqual({ from: "ADMIN", to: "USER" });
    expect(entries[0]!.actor?.id).toBe(admin.id);
  });

  test("the role change response shows the new role", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const bob = await createUser();
    expect(((await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "ADMIN" }).expect(200)).body as AdminUserRow).role).toBe("ADMIN");
  });

  test("LAST_ADMIN: the only active admin cannot delete their own account", async () => {
    // A role change or erase is always made by another active admin, so LAST_ADMIN can only arise from self-deletion.
    const admin = await createUser({ role: "ADMIN" });
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", admin.id).execute();
    const ids = others.map((o) => o.id);
    if (ids.length) await db.updateTable("users").set({ status: "SUSPENDED" }).where("id", "in", ids).execute();
    try {
      expect((await as(admin).delete("/api/users/me").send({ password: PASSWORD }).expect(409)).body.code).toBe("LAST_ADMIN");
    } finally {
      if (ids.length) await db.updateTable("users").set({ status: "ACTIVE" }).where("id", "in", ids).execute();
    }
  });

  test("suspend makes an account read-only until it ends; admins are protected; unsuspend", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const other = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const row = (await as(admin).post(`/api/admin/users/${ada.id}/suspend`).send({ days: 3, reason: "cool off" }).expect(200)).body as AdminUserRow;
    expect(row.status).toBe("SUSPENDED");
    expect(new Date(row.suspendedUntil!).getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    await as(ada).get("/api/me/preferences").expect(200);
    expect((await as(ada).patch("/api/me/preferences").send({ defaultTemplate: "modern" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(ada).get("/api/users/me").expect(200)).body).toMatchObject({ status: "SUSPENDED", suspendedUntil: row.suspendedUntil });
    await as(admin).post(`/api/admin/users/${ada.id}/suspend`).send({ days: 0 }).expect(400);
    expect((await as(admin).post(`/api/admin/users/${other.id}/suspend`).send({ days: 1 }).expect(403)).body.code).toBe("TARGET_PROTECTED");
    await as(admin).post(`/api/admin/users/${ada.id}/unsuspend`).send({}).expect(200);
    await as(ada).patch("/api/me/preferences").send({ defaultTemplate: "modern" }).expect(200);
    expect((await as(admin).post(`/api/admin/users/${ada.id}/unsuspend`).send({}).expect(409)).body.code).toBe("INVALID_STATUS");
  });

  test("ban signs the account out everywhere; unban", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    await as(admin).post(`/api/admin/users/${ada.id}/ban`).send({ reason: "spam" }).expect(200);
    expect((await as(ada).get("/api/users/me")).status).toBe(401);
    expect((await as(admin).get(`/api/admin/users?status=BANNED&q=${ada.username}`).expect(200)).body.items).toHaveLength(1);
    // Sign-in is refused while banned.
    expect((await anon().post("/api/auth/login").send({ login: ada.email, password: PASSWORD })).status).toBe(403);
    await as(admin).post(`/api/admin/users/${ada.id}/unban`).send({}).expect(200);
    await anon().post("/api/auth/login").send({ login: ada.email, password: PASSWORD }).expect(200);
  });

  test("erase removes preferences and usage, anonymises the identity, and is audited", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    await as(ada).patch("/api/me/preferences").send({ defaultTemplate: "classic" }).expect(200);
    await chargeRuns(ada.id, 1, "analyze");
    await as(admin).post(`/api/admin/users/${ada.id}/erase`).send({ reason: "x" }).expect(400);
    await as(admin).post(`/api/admin/users/${ada.id}/erase`).send({ reason: "Requested by the person" }).expect(204);
    expect(await db.selectFrom("user_preferences").select("user_id").where("user_id", "=", ada.id).execute()).toEqual([]);
    expect(await db.selectFrom("usage_monthly").select("user_id").where("user_id", "=", ada.id).execute()).toEqual([]);
    const user = await db.selectFrom("users").select(["status", "email", "display_name"]).where("id", "=", ada.id).executeTakeFirstOrThrow();
    expect(user).toMatchObject({ status: "DEACTIVATED", display_name: "Deleted user" });
    expect(user.email).not.toBe(ada.email);
    expect((await as(admin).post(`/api/admin/users/${ada.id}/erase`).send({ reason: "Again please" }).expect(409)).body.code).toBe("ALREADY_ERASED");
    expect((await auditFor(admin, ada.id)).map((e) => e.action)).toContain("user.erase");
  });

  test("tier assignment and a per-user override", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const tiers = (await as(admin).post("/api/admin/tiers").send({ name: `Staff ${Date.now().toString(36)}`, monthlyRuns: null, maxResumes: 50, maxUploadMb: 100 }).expect(201)).body as QuotaTier[];
    const staff = tiers.find((t) => t.maxResumes === 50 && t.maxUploadMb === 100)!;
    expect(staff.monthlyRuns).toBeNull();
    const row = (await as(admin).put(`/api/admin/users/${ada.id}/tier`).send({ tierId: staff.id }).expect(200)).body as AdminUserRow;
    expect(row.quotaTier).toEqual({ id: staff.id, name: staff.name });
    expect((await as(ada).get("/api/me/usage").expect(200)).body).toMatchObject({ runs: { limit: null }, limits: { monthlyRuns: null, maxResumes: 50, maxUploadMb: 100 } });

    const detail = (await as(admin).put(`/api/admin/users/${ada.id}/quota`).send({ monthlyRuns: 123, maxResumes: null, maxUploadMb: null, note: "pilot" }).expect(200)).body as AdminUserDetail;
    expect(detail.override).toMatchObject({ monthlyRuns: 123, maxResumes: null, note: "pilot" });
    expect((await as(ada).get("/api/me/usage").expect(200)).body).toMatchObject({ runs: { limit: 123 }, limits: { maxResumes: 50 } });
    await as(admin).put(`/api/admin/users/${ada.id}/quota`).send({ monthlyRuns: -1, maxResumes: null, maxUploadMb: null, note: null }).expect(400);
    expect(((await as(admin).delete(`/api/admin/users/${ada.id}/quota`).expect(200)).body as AdminUserDetail).override).toBeNull();
    await as(admin).put(`/api/admin/users/${ada.id}/tier`).send({ tierId: null }).expect(200);
    expect((await as(ada).get("/api/me/usage").expect(200)).body).toMatchObject({ runs: { limit: 20 } });
    expect((await as(admin).put(`/api/admin/users/${ada.id}/tier`).send({ tierId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(404)).body.code).toBe("TIER_NOT_FOUND");
  });
});

describe("quota tiers", () => {
  test("create, update, one default at a time, the default cannot be deleted, names are unique", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const original = ((await as(admin).get("/api/admin/tiers").expect(200)).body as QuotaTier[]).find((t) => t.isDefault)!;
    expect(original).toMatchObject({ name: "Default", monthlyRuns: 20, maxResumes: 10, maxUploadMb: 10 });
    const name = `Pro ${Date.now().toString(36)}`;
    const body = (over: object = {}) => ({ name, monthlyRuns: 100, maxResumes: 30, maxUploadMb: 50, ...over });
    let tiers = (await as(admin).post("/api/admin/tiers").send(body()).expect(201)).body as QuotaTier[];
    const pro = tiers.find((t) => t.name === name)!;
    expect((await as(admin).post("/api/admin/tiers").send(body()).expect(409)).body.code).toBe("TIER_NAME_TAKEN");
    try {
      tiers = (await as(admin).put(`/api/admin/tiers/${pro.id}`).send(body({ monthlyRuns: 200, isDefault: true })).expect(200)).body as QuotaTier[];
      expect(tiers.filter((t) => t.isDefault).map((t) => t.id)).toEqual([pro.id]);
      expect(tiers.find((t) => t.id === pro.id)!.monthlyRuns).toBe(200);
      // Users without a tier now get the new default.
      const ada = await createUser();
      expect((await as(ada).get("/api/me/usage").expect(200)).body.runs.limit).toBe(200);
      expect((await as(admin).delete(`/api/admin/tiers/${pro.id}`).expect(409)).body.code).toBe("TIER_IS_DEFAULT");
      // A default is moved to another tier, never removed: saving it with isDefault false keeps it the default.
      tiers = (await as(admin).put(`/api/admin/tiers/${pro.id}`).send(body({ monthlyRuns: 200, isDefault: false })).expect(200)).body as QuotaTier[];
      expect(tiers.filter((t) => t.isDefault).map((t) => t.id)).toEqual([pro.id]);
    } finally {
      await as(admin).put(`/api/admin/tiers/${original.id}`).send({ name: "Default", monthlyRuns: 20, maxResumes: 10, maxUploadMb: 10, isDefault: true }).expect(200);
    }
    tiers = (await as(admin).delete(`/api/admin/tiers/${pro.id}`).expect(200)).body as QuotaTier[];
    expect(tiers.some((t) => t.id === pro.id)).toBe(false);
    expect(tiers.find((t) => t.isDefault)!.id).toBe(original.id);
    await as(admin).post("/api/admin/tiers").send({ name: "Bad", monthlyRuns: 1, maxResumes: 1, maxUploadMb: 0 }).expect(400);
  });
});

describe("providers and models", () => {
  test("providers report keyConfigured, never a key; CRUD with validation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    let providers = (await as(admin).get("/api/admin/providers").expect(200)).body as AdminProvider[];
    expect(providers.find((p) => p.id === "openai")).toMatchObject({ kind: "OPENAI", keyConfigured: true });
    expect(providers.find((p) => p.id === "anthropic")).toMatchObject({ keyConfigured: false });
    expect(providers.find((p) => p.id === "stub")).toMatchObject({ kind: "STUB", keyConfigured: true, modelCount: 1 });
    expect(JSON.stringify(providers)).not.toContain(CANARY_KEY);

    const slug = `local-${Date.now().toString(36)}`;
    providers = (await as(admin).post("/api/admin/providers").send({ id: slug, kind: "OPENAI_COMPATIBLE", displayName: "Local server", baseUrl: `${stubsUrl()}/v1`, enabled: true }).expect(201)).body as AdminProvider[];
    expect(providers.find((p) => p.id === slug)).toMatchObject({ keyConfigured: false, modelCount: 0, baseUrl: `${stubsUrl()}/v1` });
    expect((await as(admin).post("/api/admin/providers").send({ id: slug, kind: "STUB", displayName: "Dup", baseUrl: null, enabled: true }).expect(409)).body.code).toBe("PROVIDER_SLUG_TAKEN");
    expect((await as(admin).post("/api/admin/providers").send({ id: `x${slug}`, kind: "OPENAI_COMPATIBLE", displayName: "No URL", baseUrl: null, enabled: true }).expect(400)).body.code).toBe("BASE_URL_REQUIRED");
    expect((await as(admin).post("/api/admin/providers").send({ id: `y${slug}`, kind: "OPENAI", displayName: "Bad URL", baseUrl: "file:///etc/passwd", enabled: true }).expect(400)).body.code).toBe("BASE_URL_INVALID");
    await as(admin).post("/api/admin/providers").send({ id: "Bad Slug!", kind: "STUB", displayName: "x", baseUrl: null, enabled: true }).expect(400);
    await as(admin).post("/api/admin/providers").send({ id: `z${slug}`, kind: "STUB", displayName: "x", baseUrl: null, enabled: true, apiKey: "sk-nope" }).expect(400);
    await as(admin).put(`/api/admin/providers/${slug}`).send({ kind: "OPENAI_COMPATIBLE", displayName: "Renamed", baseUrl: `${stubsUrl()}/v1`, enabled: false }).expect(200);
    providers = (await as(admin).delete(`/api/admin/providers/${slug}`).expect(200)).body as AdminProvider[];
    expect(providers.some((p) => p.id === slug)).toBe(false);
    await as(admin).delete(`/api/admin/providers/${slug}`).expect(404);
  });

  test("models: create, test call, duplicate refused, disable, delete", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ref = `stub-extra-${Date.now().toString(36)}`;
    let models = (await as(admin).post("/api/admin/models").send({ providerId: "stub", kind: "TEXT", modelRef: ref, displayName: "Stub Extra" }).expect(201)).body as AdminModel[];
    const extra = models.find((m) => m.modelRef === ref)!;
    expect(extra).toMatchObject({ providerId: "stub", kind: "TEXT", enabled: true, isDefault: false, contextWindow: 128000 });
    try {
      const ok = (await as(admin).post(`/api/admin/models/${extra.id}/test`).send({}).expect(200)).body as ModelTestResult;
      expect(ok).toEqual({ ok: true, latencyMs: expect.any(Number), message: "The model answered." });
      expect((await as(admin).post("/api/admin/models").send({ providerId: "stub", kind: "TEXT", modelRef: ref, displayName: "Again" }).expect(409)).body.code).toBe("MODEL_DUPLICATE");
      expect((await as(admin).post("/api/admin/models").send({ providerId: "nope-nope", kind: "TEXT", modelRef: "m", displayName: "M" }).expect(404)).body.code).toBe("PROVIDER_NOT_FOUND");
      await as(admin).post("/api/admin/models").send({ providerId: "stub", kind: "IMAGE", modelRef: "m", displayName: "M" }).expect(400);
      models = (await as(admin).put(`/api/admin/models/${extra.id}`).send({ providerId: "stub", kind: "TEXT", modelRef: ref, displayName: "Stub Extra", enabled: false }).expect(200)).body as AdminModel[];
      expect(models.find((m) => m.id === extra.id)!.enabled).toBe(false);
    } finally {
      models = (await as(admin).delete(`/api/admin/models/${extra.id}`).expect(200)).body as AdminModel[];
      clearModelCache();
    }
    expect(models.some((m) => m.id === extra.id)).toBe(false);
  });

  test("a failing model test returns a key-free, provider-text-free message", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const slug = `broken-${Date.now().toString(36)}`;
    await as(admin).post("/api/admin/providers").send({ id: slug, kind: "OPENAI_COMPATIBLE", displayName: "Broken", baseUrl: `${stubsUrl()}/nowhere`, enabled: true }).expect(201);
    try {
      const models = (await as(admin).post("/api/admin/models").send({ providerId: slug, kind: "TEXT", modelRef: "ghost", displayName: "Ghost" }).expect(201)).body as AdminModel[];
      const ghost = models.find((m) => m.providerId === slug)!;
      const res = (await as(admin).post(`/api/admin/models/${ghost.id}/test`).send({}).expect(200)).body as ModelTestResult;
      expect(res.ok).toBe(false);
      expect(res.message).toBe("The provider could not be reached or had an error.");
      expect(JSON.stringify(res)).not.toMatch(/no stub for|nowhere|POST/);
      // A provider without a key says so.
      const sonnet = (await as(admin).get("/api/admin/models").expect(200)).body.find((m: AdminModel) => m.providerId === "anthropic") as AdminModel;
      expect((await as(admin).post(`/api/admin/models/${sonnet.id}/test`).send({}).expect(200)).body).toEqual({ ok: false, latencyMs: 0, message: "No key is configured for this provider on the server." });
    } finally {
      await as(admin).delete(`/api/admin/providers/${slug}`).expect(200);
      clearModelCache();
    }
  });
});

describe("settings, integrations, stats and the audit trail", () => {
  test("settings patch merges groups, validates, and is audited with before and after", async () => {
    const admin = await createUser({ role: "ADMIN" });
    try {
      const after = (await as(admin).patch("/api/admin/settings").send({ tagline: "Ask anything", features: { demoFlag: false } }).expect(200)).body as AppSettings;
      expect(after.tagline).toBe("Ask anything");
      expect(after.features).toMatchObject({ demoFlag: false });
      expect((await as(admin).get("/api/admin/settings").expect(200)).body.tagline).toBe("Ask anything");
      const entry = (await auditFor(admin, "app")).find((e) => e.action === "settings.update")!;
      expect(entry.data).toMatchObject({ keys: ["tagline", "features"], before: { tagline: "Sharper resumes, in minutes." }, after: { tagline: "Ask anything", features: { demoFlag: false } } });
      expect((await as(admin).patch("/api/admin/settings").send({ registration: "INVITE_ONLY", allowedEmailDomains: [] }).expect(400)).body.code).toBe("SETTINGS_INVALID");
      await as(admin).patch("/api/admin/settings").send({ unknownKey: true }).expect(400);
      await as(admin).patch("/api/admin/settings").send({ features: { demoFlag: "yes" } }).expect(400);
    } finally {
      await resetSettings();
    }
  });

  test("integrations say what is configured, never a key", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const status = (await as(admin).get("/api/admin/integrations").expect(200)).body as IntegrationStatus;
    expect(status).toEqual({ mail: { mode: expect.any(String) }, storage: { mode: expect.any(String) }, ai: { providerConfigured: true } });
  });

  test("stats has the documented shape and counts this month's runs", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    await chargeRuns(ada.id, 2, "analyze");
    const stats = (await as(admin).get("/api/admin/stats").expect(200)).body as AdminStats;
    expect(Object.keys(stats.totals).sort()).toEqual(["activeUsers", "newUsers", "runs", "users"]);
    expect(stats.totals.runs).toBeGreaterThanOrEqual(2);
    const today = new Date().toISOString().slice(0, 10);
    expect(stats.to).toBe(today);
    expect(stats.daily.find((d) => d.date === today)).toMatchObject({ newUsers: expect.any(Number) });
    expect(stats.byKind.find((k) => k.kind === "analyze")!.runs).toBeGreaterThanOrEqual(2);
    expect((await as(admin).get("/api/admin/stats?from=2026-02-01&to=2026-01-01").expect(400)).body.code).toBe("RANGE_INVALID");
    expect((await as(admin).get("/api/admin/stats?from=2024-01-01&to=2026-01-01").expect(400)).body.code).toBe("RANGE_TOO_LONG");
  });

  test("the audit trail filters by action prefix and actor", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    await as(admin).post(`/api/admin/users/${ada.id}/suspend`).send({ days: 1 }).expect(200);
    const byActor = ((await as(admin).get(`/api/admin/audit?actorId=${admin.id}`).expect(200)).body as Page<AuditEntry>).items;
    expect(byActor.map((e) => e.action)).toEqual(["user.suspend"]);
    const prefix = ((await as(admin).get(`/api/admin/audit?action=user.&entityId=${ada.id}`).expect(200)).body as Page<AuditEntry>).items;
    expect(prefix).toHaveLength(1);
    expect(prefix[0]).toMatchObject({ entityType: "user", entityId: ada.id, actor: { id: admin.id }, data: { days: 1, reason: null } });
  });
});
