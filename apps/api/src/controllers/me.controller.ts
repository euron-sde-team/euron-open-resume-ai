/** Meta, preferences and usage. Thin controllers. */
import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import { appMeta } from "../services/meta.service";
import * as prefs from "../services/preferences.service";
import { usageOf } from "../services/quota.service";

export async function meta(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(await appMeta());
}

export async function usage(req: Request, res: Response) {
  res.json(await usageOf(actorOf(req).id));
}

export async function getPreferences(req: Request, res: Response) {
  res.json(await prefs.preferencesOf(actorOf(req).id));
}

export async function updatePreferences(req: Request, res: Response) {
  const body = parse(z.object({ defaultTemplate: z.string().trim().min(1).max(60).nullable() }).partial().strict(), req.body);
  res.json(await prefs.updatePreferences(actorOf(req), body));
}
