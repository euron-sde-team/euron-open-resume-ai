/**
 * Client-side checks for a resume upload. They mirror the server (type by extension here,
 * by magic bytes there; size by the user's tier, capped at 10 MB) so a person finds out
 * before the bytes go up. The server stays the authority.
 */
export const HARD_UPLOAD_CAP_MB = 10;
export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "txt", "md"] as const;
/** For the file input's `accept`. */
export const ACCEPT_ATTR = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export type UploadProblem = "empty" | "type" | "size";

export interface UploadCheck {
  ok: boolean;
  problem?: UploadProblem;
  message?: string;
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** The largest upload this person may send, in megabytes. */
export function effectiveMaxMb(tierMaxMb: number | null | undefined): number {
  return tierMaxMb && tierMaxMb > 0 ? Math.min(tierMaxMb, HARD_UPLOAD_CAP_MB) : HARD_UPLOAD_CAP_MB;
}

export function validateResumeFile(file: { name: string; size: number }, tierMaxMb?: number | null): UploadCheck {
  if (!file.size) return { ok: false, problem: "empty", message: "That file is empty." };
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return { ok: false, problem: "type", message: "Upload a PDF, DOCX, TXT or Markdown file." };
  }
  const max = effectiveMaxMb(tierMaxMb);
  if (file.size > max * 1024 * 1024) return { ok: false, problem: "size", message: `That file is larger than ${max} MB.` };
  return { ok: true };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
