/** Resume data in the account lifecycle: erasing a user's resumes, drafts and stored files. */
import type { Effects } from "../../core/effects";
import { captureError } from "../../core/logger";
import type { Executor } from "../../db/kysely";
import { storage } from "../../integrations/storage";
import { draftRepo } from "../../repositories/resume-draft.repository";
import { resumeRepo } from "../../repositories/resume.repository";

/** Delete the user's resumes (components cascade) now; their stored files once the transaction commits. */
export async function resumePurge(userId: string, trx: Executor, fx?: Effects): Promise<void> {
  const keys = await resumeRepo.fileKeys(userId, trx);
  await resumeRepo.deleteAllForUser(userId, trx);
  const removeFiles = async () => {
    for (const key of keys) await storage().delete(key).catch((err) => captureError(err, { where: "account.purge.file" }));
  };
  if (fx) fx.after(removeFiles);
  else await removeFiles();
}

export async function resumeDraftsPurge(userId: string, trx: Executor): Promise<void> {
  await draftRepo.deleteAllForUser(userId, trx);
}
