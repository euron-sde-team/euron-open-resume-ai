/**
 * Every router and where it is mounted. scripts/gen-openapi.ts reads this file, so keep
 * one `[prefix, router]` entry per line. Add the resume routers here.
 */
import type { Express } from "express";
import { router as admin } from "./admin.routes";
import { router as auth } from "./auth.routes";
import { router as builderAi } from "./builder-ai.routes";
import { router as builder } from "./builder.routes";
import { router as drafts } from "./drafts.routes";
import { router as me } from "./me.routes";
import { router as meta } from "./meta.routes";
import { router as resumes } from "./resumes.routes";
import { router as storageLocal } from "./storage.routes";
import { router as users } from "./users.routes";

export const MOUNTS = [
  ["/api/auth", auth],
  ["/api/users", users],
  ["/api/meta", meta],
  ["/api/me", me],
  ["/api/resumes", resumes],
  ["/api/drafts", drafts],
  ["/api/files", storageLocal],
  ["/api/admin", admin],
  ["/api/builder", builderAi],
  ["/api", builder],
] as const;

export function mountRoutes(app: Express): void {
  for (const [prefix, router] of MOUNTS) app.use(prefix, router);
}
