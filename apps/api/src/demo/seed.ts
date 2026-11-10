/**
 * Demo data so a fresh install has something to look at. Run with `make demo` (or
 * `node dist/cli.js demo:seed`).
 *
 *   - the starter model catalogue plus the local stub provider (AI tasks answer through it)
 *   - an admin and four people, one on a higher-limit "Staff" tier
 *   - some monthly usage for every account, for the admin overview
 *   - analysed resumes for the four people (demo/resumes.ts), run inline with the offline engine
 *
 * Refuses to run with
 * NODE_ENV=production. If the demo admin exists it prints the logins and exits.
 */
import crypto from "node:crypto";
import { config } from "../core/config";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { closeRedis } from "../integrations/redis";
import { closeQueues } from "../jobs/registry";
import { hashPassword } from "../security/passwords";
import { sql } from "kysely";
import { ensureStarterCatalog } from "./catalog";
import { seedDemoResumes } from "./resumes";
import type { Actor } from "../core/context";

const ADMIN_EMAIL = "admin@example.com";
const DAY = 86_400_000;

const PEOPLE = [
  { email: "priya.nair@example.com", username: "priya-nair", name: "Priya Nair" },
  { email: "leo.marquez@example.com", username: "leo-marquez", name: "Leo Marquez" },
  { email: "sam.kowalski@example.com", username: "sam-kowalski", name: "Sam Kowalski" },
  { email: "amara.okafor@example.com", username: "amara-okafor", name: "Amara Okafor" },
];

export async function seedDemo(): Promise<void> {
  if (config.NODE_ENV === "production") throw new Error("demo:seed refuses to run in production");
  const password = config.DEMO_PASSWORD ?? crypto.randomBytes(9).toString("base64url");
  const existing = await db.selectFrom("users").select("id").where("email", "=", ADMIN_EMAIL).executeTakeFirst();
  if (existing) {
    printLogins(config.DEMO_PASSWORD ? password : null);
    return;
  }
  // The stub is listed but disabled (an admin can switch it on in /admin/models): a fresh
  // demo analyses the uploaded file with the offline engine instead of returning the
  // stub's canned answers.
  await ensureStarterCatalog(db, { includeStub: true, stubIsDefault: false });
  const hash = await hashPassword(password);
  const now = Date.now();

  await db.insertInto("users").values({ id: newId(), email: ADMIN_EMAIL, username: "admin", display_name: "Morgan Ellis", password_hash: hash, role: "ADMIN", status: "ACTIVE", email_verified_at: new Date(now - 40 * DAY), created_at: new Date(now - 40 * DAY) }).execute();
  const staffTier = newId();
  await db.insertInto("quota_tiers").values({ id: staffTier, name: "Staff", monthly_runs: 200, max_resumes: 50, max_upload_mb: 25 }).execute();

  const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const actors: Actor[] = [];
  for (const [i, p] of PEOPLE.entries()) {
    const id = newId();
    actors.push({ id, username: p.username, displayName: p.name, role: "USER", status: "ACTIVE" });
    await db
      .insertInto("users")
      .values({ id, email: p.email, username: p.username, display_name: p.name, password_hash: hash, role: "USER", status: "ACTIVE", email_verified_at: new Date(now - (30 - i) * DAY), created_at: new Date(now - (30 - i) * DAY), quota_tier_id: i === 1 ? staffTier : null, last_seen_at: new Date(now - i * 3_600_000) })
      .execute();
    for (const [kind, runs] of [["analyze", 3 + i], ["improve", 2 + i]] as const) {
      await db.insertInto("usage_monthly").values({ user_id: id, month: sql<Date>`${month.toISOString().slice(0, 10)}::date`, kind, runs }).execute();
    }
  }
  await seedDemoResumes(actors);
  printLogins(password);
  await closeQueues();
  await closeRedis();
}

function printLogins(password: string | null): void {
  const lines = [
    "",
    "  Demo accounts (all share one password):",
    `    admin     ${ADMIN_EMAIL}`,
    ...PEOPLE.map((p) => `    user      ${p.email}`),
    password ? "" : "  The password was printed when the demo was first seeded (DEMO_PASSWORD in deploy/compose/.env).",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
