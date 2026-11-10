import type { ResumeDocument } from "@open-resume/types";

/** True when the document holds anything worth rendering or saving. */
export function hasContent(doc: ResumeDocument | null | undefined): boolean {
  if (!doc) return false;
  const p = doc.personal ?? {};
  return !!(
    p.fullName?.trim() ||
    p.headline?.trim() ||
    p.email?.trim() ||
    doc.summary?.trim() ||
    doc.experience?.length ||
    doc.education?.length ||
    doc.skills?.length ||
    doc.projects?.length ||
    doc.certifications?.length ||
    doc.achievements?.length
  );
}

/** Replaces the item at `i` with a patched copy. */
export function patchAt<T>(list: T[] | undefined, i: number, patch: Partial<T>): T[] {
  return (list ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x));
}

export function removeAt<T>(list: T[] | undefined, i: number): T[] {
  return (list ?? []).filter((_, j) => j !== i);
}

/** "a, b ,, c" -> ["a","b","c"]. */
export function parseCsv(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One entry per non-empty line. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A name for the file or draft: the person, else a fallback. */
export function documentTitle(doc: ResumeDocument | null | undefined, fallback = "Untitled resume"): string {
  const n = doc?.personal?.fullName?.trim();
  const h = doc?.personal?.headline?.trim();
  return n ? (h ? `${n}, ${h}` : n) : fallback;
}

/** The manifest-free document of a sample (the sample's id, role and tags are not part of the resume). */
export function documentFromSample<S extends Record<string, unknown>>(s: S): ResumeDocument {
  const { personal, links, summary, experience, education, skills, projects, certifications, languages, achievements } = s as ResumeDocument;
  return { personal, links, summary, experience, education, skills, projects, certifications, languages, achievements };
}
