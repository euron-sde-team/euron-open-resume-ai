import type { ComponentKind, ResumeStatus, ResumeSummary, TemplateId } from "@open-resume/types";
import { TEMPLATE_IDS, DEFAULT_TEMPLATE_ID } from "@open-resume/types";

/** Status as a word, never a coloured chip. */
export const STATUS_WORD: Record<ResumeStatus, string> = {
  queued: "Waiting",
  processing: "Analysing",
  analyzed: "Analysed",
  error: "Needs attention",
};

export const COMPONENT_LABEL: Record<ComponentKind, string> = {
  analysis: "Scoring the resume",
  rewrite: "Writing the improved resume",
  interview_non_technical: "Interview questions",
  interview_dsa: "DSA questions",
  interview_programming: "Programming questions",
  interview_system_design: "System design questions",
  roadmap: "Career roadmap",
  projects: "Project ideas",
};

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);
}

export function asTemplateId(v: unknown): TemplateId {
  return isTemplateId(v) ? v : DEFAULT_TEMPLATE_ID;
}

/** "PDF · scored 74 · Acme" style line: facts joined by middle dots. */
export function metaLine(parts: (string | number | null | undefined | false)[]): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "").join(" · ");
}

export function resumeFacts(r: ResumeSummary): string[] {
  return [r.source === "builder" ? "Built here" : r.fileName || "Uploaded", r.company || null, r.isTailored ? "Tailored" : null].filter(Boolean) as string[];
}

export function scoreText(score: number | undefined): string {
  return typeof score === "number" ? `${Math.round(score)}` : "";
}

export function fileNameFor(title: string, ext: string): string {
  const base = title.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "resume";
  return `${base}.${ext}`;
}
