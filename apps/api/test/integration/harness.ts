/**
 * Test harness: the app in-process, fast user creation, the starter model catalogue
 * (with the stub provider).
 *
 *   const ada = await createUser();                  // ACTIVE, verified USER
 *   const res = await as(ada).get("/api/me/usage");
 */
import { beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { newId } from "../../src/core/ids";
import { db, initDbTypes } from "../../src/db/kysely";
import { ensureStarterCatalog } from "../../src/demo/catalog";
import { registerAllJobs } from "../../src/jobs";
import { hashPassword } from "../../src/security/passwords";
import { signAccessToken } from "../../src/security/tokens";
import { clearModelCache } from "../../src/services/models.service";
import { clearSettingsCache, saveSettings } from "../../src/services/settings.service";
import type { AppSettings } from "@open-resume/types";

registerAllJobs();
export const app = createApp();

// enum[] and citext[] columns parse as arrays only after this lookup, as at boot.
beforeAll(async () => {
  await initDbTypes();
  await ensureStarterCatalog(db, { includeStub: true });
  clearModelCache();
});

export const PASSWORD = "correct-horse-battery-staple";
let passwordHash: string | null = null;

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  token: string;
}

let counter = 0;
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.slice(0, 38);
}

export type Role = "USER" | "ADMIN";

/** Insert an ACTIVE, verified user directly, and mint an access token for them. */
export async function createUser(over: { role?: Role; status?: "ACTIVE" | "SUSPENDED" | "BANNED"; displayName?: string; username?: string } = {}): Promise<TestUser> {
  passwordHash ??= await hashPassword(PASSWORD);
  const username = over.username ?? unique("u");
  const email = `${username}@example.com`;
  const row = await db
    .insertInto("users")
    .values({
      id: newId(),
      email,
      username,
      display_name: over.displayName ?? `User ${username}`,
      password_hash: passwordHash,
      role: over.role ?? "USER",
      status: over.status ?? "ACTIVE",
      email_verified_at: new Date(),
      ...(over.status === "SUSPENDED" ? { suspended_until: new Date(Date.now() + 86_400_000) } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { id: row.id, email, username, displayName: row.display_name, token: signAccessToken(row.id, row.token_version) };
}

/** A supertest agent that sends the user's bearer token on every request. */
export function as(user: TestUser | null) {
  const agent = request(app);
  const auth = (r: request.Test) => (user ? r.set("Authorization", `Bearer ${user.token}`) : r);
  return {
    get: (url: string) => auth(agent.get(url)),
    post: (url: string) => auth(agent.post(url)),
    put: (url: string) => auth(agent.put(url)),
    patch: (url: string) => auth(agent.patch(url)),
    delete: (url: string) => auth(agent.delete(url)),
  };
}

export const anon = () => as(null);

// ─── Models ─────────────────────────────────────────────────────────────────

/** The id of the stub provider's text model (ensureStarterCatalog inserted it). */
export async function stubModel(): Promise<string> {
  const row = await db.selectFrom("models").select("id").where("provider_id", "=", "stub").where("model_ref", "=", "stub-text").executeTakeFirstOrThrow();
  return row.id;
}

// ─── Settings ───────────────────────────────────────────────────────────────

/** Merge a patch into the deployment settings (in-process cache cleared). */
export async function setSettings(patch: Partial<AppSettings>): Promise<void> {
  clearSettingsCache();
  await saveSettings(patch, null);
  clearSettingsCache();
}

/** Back to the defaults. */
export async function resetSettings(): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", "app").execute();
  clearSettingsCache();
}

// ─── Stubs ──────────────────────────────────────────────────────────────────

export function stubsUrl(): string {
  return process.env.STUBS_URL!;
}

export interface StubRequest {
  method: string;
  path: string;
  at: string;
  body: any;
}

/** What the stub providers received, newest first. */
export async function stubRequests(): Promise<StubRequest[]> {
  const res = await fetch(`${stubsUrl()}/__/requests`);
  return (await res.json()) as StubRequest[];
}

// ─── Polling ────────────────────────────────────────────────────────────────

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, everyMs = 50): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
