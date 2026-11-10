/**
 * The canonical ResumeDocument as the AI layer sees it: a tolerant zod schema that trims,
 * drops empties and caps sizes (used on model output and on stored documents), URL
 * filtering, and a plain-text rendering used both as prompt input and as the format the
 * offline parser reads back (document -> text -> parse keeps the key fields).
 */
import type { ResumeDocument } from "@open-resume/types";
import { z } from "zod";

// ─── Tolerant primitives ────────────────────────────────────────────────────

const asText = (v: unknown): unknown => (typeof v === "number" || typeof v === "boolean" ? String(v) : v);

/** Trimmed text, capped; anything that is not text becomes undefined. */
export const text = (max: number) =>
  z.preprocess(asText, z.string().nullish().catch(undefined)).transform((v) => {
    const t = (v ?? "").replaceAll("\u0000", "").trim().slice(0, max);
    return t || undefined;
  });

/** A list of non-empty trimmed strings (a lone string becomes a one item list). */
export const textList = (maxItems: number, maxLen: number) =>
  z
    .preprocess((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : []), z.array(text(maxLen)).catch([]))
    .transform((a) => a.filter((x): x is string => !!x).slice(0, maxItems));

/** An http(s), mailto or tel URL, or undefined. */
export function safeUrl(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(t)) return t.slice(0, 500);
  // "github.com/ada" without a scheme is a common way to write it.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t) && !/\s/.test(t)) return `https://${t}`.slice(0, 500);
  return undefined;
}

/** A small inline image the user attached; anything else is dropped. */
const PHOTO_RE = /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$/i;
export const validPhoto = (v: unknown): v is string => typeof v === "string" && v.length <= 4_000_000 && PHOTO_RE.test(v);

const url = z.preprocess(asText, z.string().nullish().catch(undefined)).transform((v) => safeUrl(v ?? undefined));

const list = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(item.nullish().catch(undefined)).catch([])).transform((a) => a.filter((x): x is NonNullable<z.output<T>> => x !== undefined && x !== null).slice(0, max));

// ─── The document ───────────────────────────────────────────────────────────

const experience = z
  .object({
    title: text(160),
    company: text(160),
    location: text(160),
    start: text(40),
    end: text(40),
    bullets: textList(30, 600),
    description: text(1500),
  })
  .transform((e) => (e.title || e.company ? e : undefined));

const education = z
  .object({ degree: text(200), institution: text(200), location: text(160), start: text(40), end: text(40), details: text(1000), score: text(60) })
  .transform((e) => (e.degree || e.institution ? e : undefined));

const skillGroup = z.object({ category: text(100), items: textList(60, 80) }).transform((g) => (g.items.length ? g : undefined));

const project = z
  .object({ name: text(200), description: text(1500), link: url, tech: textList(30, 60), bullets: textList(20, 600) })
  .transform((p) => (p.name ? p : undefined));

const certification = z.object({ name: text(200), issuer: text(160), date: text(40), link: url }).transform((c) => (c.name ? c : undefined));

const language = z.object({ name: text(60), level: text(60) }).transform((l) => (l.name ? l : undefined));

const links = z
  .object({
    portfolio: url,
    github: url,
    linkedin: url,
    twitter: url,
    youtube: url,
    other: list(z.object({ label: text(60), url }).transform((o) => (o.url ? o : undefined)), 10),
  })
  .catch({ other: [] })
  .transform((l) => ({ ...l, other: l.other.length ? l.other : undefined }));

export const documentSchema: z.ZodType<ResumeDocument, z.ZodTypeDef, unknown> = z
  .object({
    personal: z
      .object({ fullName: text(120), headline: text(200), email: text(200), phone: text(60), location: text(160), photoDataUrl: z.unknown().transform((v) => (validPhoto(v) ? v : undefined)) })
      .catch({} as never),
    links,
    summary: text(2500),
    experience: list(experience, 25),
    education: list(education, 15),
    skills: list(skillGroup, 20),
    projects: list(project, 20),
    certifications: list(certification, 25),
    languages: list(language, 15),
    achievements: textList(25, 400),
  })
  .passthrough()
  .transform((d) => {
    const { personal, links: l, summary, experience: ex, education: ed, skills, projects, certifications, languages, achievements } = d;
    const out: ResumeDocument = { personal, links: l, summary, experience: ex, education: ed, skills, projects, certifications, languages, achievements };
    return out;
  }) as z.ZodType<ResumeDocument, z.ZodTypeDef, unknown>;

/** Normalise any document-shaped value; garbage becomes an empty document. */
export function normalizeDocument(value: unknown): ResumeDocument {
  const r = documentSchema.safeParse(value ?? {});
  return r.success ? r.data : emptyDocument();
}

export function emptyDocument(): ResumeDocument {
  return { personal: {}, links: {}, summary: undefined, experience: [], education: [], skills: [], projects: [], certifications: [], languages: [], achievements: [] };
}

/** Whether the document holds anything worth keeping. */
export function hasContent(doc: ResumeDocument): boolean {
  return !!(doc.personal?.fullName || doc.summary || doc.experience?.length || doc.education?.length || doc.skills?.length || doc.projects?.length);
}

/** Keep the user's own contact data and photo whatever a model returned. */
export function restoreOwnerFields(out: ResumeDocument, original: ResumeDocument): ResumeDocument {
  const p = original.personal ?? {};
  const personal = { ...(out.personal ?? {}) };
  for (const k of ["fullName", "email", "phone", "location"] as const) if (p[k]) personal[k] = p[k];
  // The photo never comes from a model: the user's own copy, or none.
  if (validPhoto(p.photoDataUrl)) personal.photoDataUrl = p.photoDataUrl;
  else delete personal.photoDataUrl;
  const ol = original.links ?? {};
  const links = { ...(out.links ?? {}) };
  for (const k of ["portfolio", "github", "linkedin", "twitter", "youtube"] as const) if (ol[k]) links[k] = ol[k];
  if (!links.other?.length && ol.other?.length) links.other = ol.other;
  return { ...out, personal, links };
}

/** Sections the model left out are taken from the original rather than silently lost. */
export function fillMissingSections(out: ResumeDocument, original: ResumeDocument): ResumeDocument {
  const keep = <K extends keyof ResumeDocument>(k: K): Partial<ResumeDocument> => {
    const o = out[k];
    const orig = original[k];
    const empty = Array.isArray(o) ? o.length === 0 : !o;
    return empty && orig ? { [k]: orig } : {};
  };
  return {
    ...out,
    ...keep("experience"),
    ...keep("education"),
    ...keep("skills"),
    ...keep("projects"),
    ...keep("certifications"),
    ...keep("languages"),
    ...keep("achievements"),
  };
}

// ─── Plain text ─────────────────────────────────────────────────────────────

const range = (a?: string, b?: string) => [a, b].filter(Boolean).join(" - ");

/**
 * The document as plain text, in the layout the offline parser reads:
 * contact header, then SECTION headings, `a | b | c | dates` entry lines, "- " bullets.
 */
export function documentToText(doc: ResumeDocument): string {
  const out: string[] = [];
  const p = doc.personal ?? {};
  if (p.fullName) out.push(p.fullName);
  if (p.headline) out.push(p.headline);
  const contact = [p.email, p.phone, p.location].filter(Boolean).join(" | ");
  if (contact) out.push(contact);
  const l = doc.links ?? {};
  const urls = [l.portfolio, l.github, l.linkedin, l.twitter, l.youtube, ...(l.other ?? []).map((o) => o.url)].filter(Boolean);
  if (urls.length) out.push(urls.join(" | "));

  const section = (title: string, lines: string[]) => {
    if (lines.length) out.push("", title, ...lines);
  };
  if (doc.summary) section("SUMMARY", [doc.summary]);

  section(
    "EXPERIENCE",
    (doc.experience ?? []).flatMap((e, i) => [
      ...(i ? [""] : []),
      [e.title, e.company, e.location, range(e.start, e.end)].filter(Boolean).join(" | "),
      ...(e.description ? [e.description] : []),
      ...(e.bullets ?? []).map((b) => `- ${b}`),
    ]),
  );
  section(
    "EDUCATION",
    (doc.education ?? []).flatMap((e, i) => [
      ...(i ? [""] : []),
      [e.degree, e.institution, e.location, range(e.start, e.end)].filter(Boolean).join(" | "),
      ...(e.score ? [e.score] : []),
      ...(e.details ? [e.details] : []),
    ]),
  );
  section(
    "SKILLS",
    (doc.skills ?? []).map((g) => (g.category ? `${g.category}: ${(g.items ?? []).join(", ")}` : (g.items ?? []).join(", "))),
  );
  section(
    "PROJECTS",
    (doc.projects ?? []).flatMap((pr, i) => [
      ...(i ? [""] : []),
      [pr.name, pr.link].filter(Boolean).join(" | "),
      ...(pr.description ? [pr.description] : []),
      ...(pr.tech?.length ? [`Tech: ${pr.tech.join(", ")}`] : []),
      ...(pr.bullets ?? []).map((b) => `- ${b}`),
    ]),
  );
  section(
    "CERTIFICATIONS",
    (doc.certifications ?? []).map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(" | ")),
  );
  section(
    "LANGUAGES",
    [(doc.languages ?? []).map((x) => (x.level ? `${x.name} (${x.level})` : x.name)).join(", ")].filter(Boolean),
  );
  section(
    "ACHIEVEMENTS",
    (doc.achievements ?? []).map((a) => `- ${a}`),
  );
  return out.join("\n");
}

/** Every bullet in the document (experience and projects), in order. */
export function allBullets(doc: ResumeDocument): string[] {
  return [...(doc.experience ?? []).flatMap((e) => e.bullets ?? []), ...(doc.projects ?? []).flatMap((p) => p.bullets ?? [])];
}

export function allSkills(doc: ResumeDocument): string[] {
  return (doc.skills ?? []).flatMap((g) => g.items ?? []);
}
