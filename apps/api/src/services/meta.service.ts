/** GET /api/meta: what a client needs before anyone signs in. Never a key, never a provider name. */
import type { AppMeta } from "@open-resume/types";
import { db } from "../db/kysely";
import { getSettings } from "./settings.service";

export async function appMeta(): Promise<AppMeta> {
  const [s, tier] = await Promise.all([getSettings(), db.selectFrom("quota_tiers").select("max_upload_mb").where("is_default", "=", true).executeTakeFirst()]);
  return {
    appName: s.appName,
    tagline: s.tagline,
    registration: s.registration,
    features: { ...s.features },
    limits: { maxUploadMb: tier?.max_upload_mb ?? 10 },
    support: { email: s.supportEmail },
    minSupportedVersion: s.minSupportedVersion,
  };
}
