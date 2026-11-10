/**
 * The offline improver: tightens what is there without inventing anything. It rewrites
 * filler openers ("Responsible for managing X" -> "Managed X"), strips filler words,
 * fixes capitalisation and duplicates, writes a summary from the facts when there is none
 * and puts the skills a job description asks for first. Numbers, employers, titles and
 * dates are never touched.
 */
import type { ResumeDocument, ResumeExperience, ResumeProject } from "@open-resume/types";
import { allSkills } from "../document";
import { FILLER_WORDS, GERUND_TO_PAST, capFirst, hasTerm } from "./lexicon";

interface Opener {
  re: RegExp;
  /** Verb to use when the rest does not start with a known gerund. */
  fallback: string;
  gerund: boolean;
}

const OPENERS: Opener[] = [
  { re: /^(?:i\s+(?:was|am|have been)\s+)?responsible\s+for\s+/i, fallback: "Owned", gerund: true },
  { re: /^duties\s+(?:included|include)\s*[:-]?\s*/i, fallback: "Handled", gerund: true },
  { re: /^tasked\s+with\s+/i, fallback: "Handled", gerund: true },
  { re: /^in\s+charge\s+of\s+/i, fallback: "Oversaw", gerund: true },
  { re: /^(?:was\s+)?involved\s+in\s+/i, fallback: "Contributed to", gerund: true },
  { re: /^worked\s+on\s+/i, fallback: "Contributed to", gerund: true },
  { re: /^helped\s+with\s+/i, fallback: "Supported", gerund: true },
];

export function improveBullet(input: string): string {
  let t = input.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const original = t;
  for (const o of OPENERS) {
    const m = o.re.exec(t);
    if (!m) continue;
    const rest = t.slice(m[0].length).trim();
    if (!rest) break;
    const first = rest.split(/\s+/)[0]!.toLowerCase();
    const past = o.gerund ? GERUND_TO_PAST[first] : undefined;
    t = past ? `${past} ${rest.slice(first.length).trim()}` : `${o.fallback} ${rest}`;
    break;
  }
  // First person: "I built X" -> "Built X".
  t = t.replace(/^i\s+(?=[a-z]+ed\b|built\b|led\b|ran\b|wrote\b|drove\b|sold\b|won\b|made\b|set\b|took\b|taught\b)/i, "");
  for (const f of FILLER_WORDS) t = t.replace(f, (m) => (/in order to/i.test(m) ? "to" : ""));
  t = t.replace(/\s+([,.;:])/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,;:-]+/, "").trim();
  t = capFirst(t);
  return t.split(/\s+/).length < 2 ? original : t;
}

function improveBullets(bullets: string[] | undefined): string[] | undefined {
  if (!bullets) return bullets;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bullets) {
    const n = improveBullet(b);
    const key = n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!n || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** Years between the earliest start year and now, or null when the dates do not say. */
export function yearsOfExperience(doc: ResumeDocument, now = new Date()): number | null {
  const years = (doc.experience ?? []).flatMap((e) => [e.start, e.end]).flatMap((d) => (d ? [...d.matchAll(/(?:19|20)\d{2}/g)].map((m) => Number(m[0])) : []));
  if (!years.length) return null;
  const span = now.getFullYear() - Math.min(...years);
  return span >= 0 && span < 60 ? span : null;
}

function buildSummary(doc: ResumeDocument, now: Date): string | undefined {
  const exp = doc.experience ?? [];
  const role = doc.personal?.headline || exp[0]?.title;
  const skills = allSkills(doc).slice(0, 6);
  if (!role && !skills.length) return undefined;
  const years = yearsOfExperience(doc, now);
  const companies = [...new Set(exp.map((e) => e.company).filter(Boolean))].slice(0, 3) as string[];
  const parts: string[] = [];
  parts.push(`${role ?? "Professional"}${years && years >= 2 ? ` with ${years}+ years of experience` : ""}${companies.length ? `, most recently at ${companies[0]}` : ""}.`);
  if (companies.length > 1) parts.push(`Previous work includes ${companies.slice(1).join(" and ")}.`);
  if (skills.length) parts.push(`Skilled in ${skills.slice(0, -1).join(", ")}${skills.length > 1 ? " and " : ""}${skills.at(-1)}.`);
  return parts.join(" ");
}

export function improveDocument(doc: ResumeDocument, job: { jd?: string } = {}, now = new Date()): ResumeDocument {
  const jd = job.jd?.toLowerCase();
  const experience: ResumeExperience[] = (doc.experience ?? []).map((e) => ({ ...e, bullets: improveBullets(e.bullets) }));
  const projects: ResumeProject[] = (doc.projects ?? []).map((p) => ({ ...p, bullets: improveBullets(p.bullets) }));
  let skills = (doc.skills ?? []).map((g) => {
    if (!jd) return g;
    const items = [...(g.items ?? [])];
    const rank = (x: string) => (hasTerm(jd, x) ? 0 : 1);
    return { ...g, items: items.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((o) => o.x) };
  });
  if (jd) {
    const hits = (g: { items?: string[] }) => (g.items ?? []).filter((x) => hasTerm(jd, x)).length;
    skills = skills.map((g, i) => ({ g, i })).sort((a, b) => hits(b.g) - hits(a.g) || a.i - b.i).map((o) => o.g);
  }
  return {
    ...doc,
    summary: doc.summary?.trim() || buildSummary(doc, now),
    experience,
    projects,
    skills,
  };
}
