/**
 * Provider keys never leave the server. OPENAI_API_KEY is set to a canary value for the
 * whole suite (env.ts); this file walks every kind of response a user and an admin can
 * fetch, and the database, and asserts the canary is nowhere.
 */
import { describe, expect, test } from "vitest";
import { sql } from "kysely";
import { db } from "../../src/db/kysely";
import { CANARY_KEY } from "./env";
import { anon, as, createUser, stubModel } from "./harness";

describe("the provider key canary", () => {
  test("appears in no response a user or an admin can fetch", async () => {
    expect(process.env.OPENAI_API_KEY).toBe(CANARY_KEY);
    const user = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const main = await stubModel();

    const bodies: string[] = [];
    const userGets = ["/api/meta", "/api/me/usage", "/api/me/preferences", "/api/users/me", "/api/users/me/sessions", "/api/users/me/export"];
    for (const url of userGets) bodies.push((await as(user).get(url).expect(200)).text);
    bodies.push((await anon().get("/api/meta").expect(200)).text);

    const adminGets = ["/api/admin/me", "/api/admin/stats", "/api/admin/users", `/api/admin/users/${user.id}`, "/api/admin/tiers", "/api/admin/providers", "/api/admin/models", "/api/admin/settings", "/api/admin/integrations", "/api/admin/audit?limit=100"];
    for (const url of adminGets) bodies.push((await as(admin).get(url).expect(200)).text);
    bodies.push((await as(admin).post(`/api/admin/models/${main}/test`).send({}).expect(200)).text);
    // Error envelopes too.
    bodies.push((await as(user).get("/api/admin/providers").expect(403)).text);
    bodies.push((await as(user).patch("/api/me/preferences").send({ defaultTemplate: 5 }).expect(400)).text);

    for (const b of bodies) {
      expect(b).not.toContain(CANARY_KEY);
      expect(b).not.toContain("canary-value");
    }
    // The providers list still says a key is configured, without the key.
    expect((await as(admin).get("/api/admin/providers").expect(200)).body.find((p: { id: string }) => p.id === "openai").keyConfigured).toBe(true);
  });

  test("is stored nowhere in the database", async () => {
    const hits = await sql<{ n: number }>`
      SELECT (SELECT count(*) FROM settings WHERE value::text LIKE ${`%${CANARY_KEY}%`})
           + (SELECT count(*) FROM providers WHERE coalesce(base_url, '') LIKE ${`%${CANARY_KEY}%`})
           + (SELECT count(*) FROM audit_log WHERE data::text LIKE ${`%${CANARY_KEY}%`}) AS n`.execute(db);
    expect(Number(hits.rows[0]!.n)).toBe(0);
  });
});
