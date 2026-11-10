/** Serves signed local-storage links (STORAGE=local only). */
import type { Request, Response } from "express";
import { config } from "../core/config";
import { forbidden, notFound } from "../core/errors";
import { storage, verifyLocal } from "../integrations/storage";

export async function localGet(req: Request, res: Response) {
  if (config.STORAGE !== "local") throw notFound();
  const grant = verifyLocal(String(req.params.token ?? ""), "get");
  if (!grant) throw forbidden("Link is invalid or expired", "FILE_LINK_INVALID");
  const store = storage();
  const head = await store.head(grant.key);
  if (!head) throw notFound();
  const type = head.contentType ?? "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(head.sizeBytes));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", `attachment; filename="${grant.extra || grant.key.split("/").pop()}"`);
  res.end(await store.get(grant.key));
}
