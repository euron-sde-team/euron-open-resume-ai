/** Per-user preferences (the template the picker preselects). */
import type { Preferences } from "@open-resume/types";
import { type Actor, requireActive } from "../core/context";
import { db, type Executor } from "../db/kysely";

export async function preferencesOf(userId: string, exec: Executor = db): Promise<Preferences> {
  const row = await exec.selectFrom("user_preferences").selectAll().where("user_id", "=", userId).executeTakeFirst();
  return { defaultTemplate: row?.default_template ?? null };
}

export async function updatePreferences(actor: Actor, patch: Partial<Preferences>): Promise<Preferences> {
  requireActive(actor);
  const values = { ...(patch.defaultTemplate !== undefined ? { default_template: patch.defaultTemplate } : {}) };
  await db
    .insertInto("user_preferences")
    .values({ user_id: actor.id, ...values })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ ...values, updated_at: new Date() }))
    .execute();
  return preferencesOf(actor.id);
}
