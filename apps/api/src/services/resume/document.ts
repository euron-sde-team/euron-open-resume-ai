/**
 * The canonical ResumeDocument normaliser. Everything that enters the system as a resume
 * (the builder, the AI parse of an upload, the AI rewrite, drafts) passes through here
 * before it is stored, rendered or sent to a model:
 *
 *   - every string is trimmed and stripped of control characters (a NUL byte also breaks
 *     Postgres jsonb), then capped; empty strings, empty entries and empty lists vanish;
 *   - lists are capped in size, so a hostile or runaway document cannot grow without bound;
 *   - photoDataUrl survives only as data:image/(png|jpeg|gif);base64,...;
 *   - link fields survive only as http(s), mailto or tel URLs (a bare "github.com/me" gets https://).
 *
 * The function never throws and never mutates its input. Unknown keys are dropped.
 */
import type {
  ResumeCertification,
  ResumeDocument,
  ResumeEducation,
  ResumeExperience,
  ResumeLanguage,
  ResumeLinks,
  ResumePersonal,
  ResumeProject,
  ResumeSkillGroup,
} from "@open-resume/types";
import { z } from "zod";

export const LIMITS = {
  short: 160,
  medium: 400,
  bullet: 600,
  summary: 3000,
  description: 1500,
  url: 2048,
  photo: 1_000_000,
  experience: 30,
  education: 15,
  skillGroups: 20,
  skillItems: 60,
  projects: 20,
  certifications: 30,
  languages: 20,
  achievements: 30,
  bullets: 30,
  tech: 30,
  otherLinks: 10,
} as const;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const PHOTO = /^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trimmed text, controls removed, capped; undefined when nothing is left. */
export function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CONTROL, "").trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

/** A link that is safe to put in an href, or undefined. */
export function cleanUrl(v: unknown): string | undefined {
  const raw = cleanText(v, LIMITS.url);
  if (!raw || /\s/.test(raw)) return undefined;
  const scheme = SCHEME.exec(raw)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === "http" || scheme === "https") {
      try {
        return new URL(raw).host ? raw : undefined;
      } catch {
        return undefined;
      }
    }
    if (scheme === "mailto" || scheme === "tel") return raw.length > scheme.length + 1 ? raw : undefined;
    // "localhost:3000" and "host.com:80" parse as a scheme; only a dotted host:port is a bare address.
    if (!BARE_HOST.test(raw)) return undefined;
  }
  if (BARE_HOST.test(raw)) {
    try {
      return new URL(`https://${raw}`).host ? `https://${raw}` : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function cleanPhoto(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length <= LIMITS.photo && PHOTO.test(s) ? s : undefined;
}

function strings(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = cleanText(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function entries<T>(v: unknown, max: number, map: (o: Record<string, unknown>) => T | undefined): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const mapped = map(item);
    if (mapped) out.push(mapped);
    if (out.length >= max) break;
  }
  return out;
}

/** Drop undefined and empty-array fields; undefined when no field is left. */
function compact<T extends object>(o: T): T | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(o)) {
    if (val === undefined) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    out[k] = val;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}

function personal(v: unknown): ResumePersonal | undefined {
  if (!isObject(v)) return undefined;
  return compact({
    fullName: cleanText(v.fullName, LIMITS.short),
    headline: cleanText(v.headline, LIMITS.medium),
    email: cleanText(v.email, LIMITS.short),
    phone: cleanText(v.phone, 60),
    location: cleanText(v.location, LIMITS.short),
    photoDataUrl: cleanPhoto(v.photoDataUrl),
  });
}

function links(v: unknown): ResumeLinks | undefined {
  if (!isObject(v)) return undefined;
  const other = entries(v.other, LIMITS.otherLinks, (o) => {
    const url = cleanUrl(o.url);
    return url ? compact({ label: cleanText(o.label, 60), url }) : undefined;
  });
  return compact({
    portfolio: cleanUrl(v.portfolio),
    github: cleanUrl(v.github),
    linkedin: cleanUrl(v.linkedin),
    twitter: cleanUrl(v.twitter),
    youtube: cleanUrl(v.youtube),
    other,
  });
}

const experience = (v: unknown): ResumeExperience[] =>
  entries(v, LIMITS.experience, (o) =>
    compact({
      title: cleanText(o.title, LIMITS.short),
      company: cleanText(o.company, LIMITS.short),
      location: cleanText(o.location, LIMITS.short),
      start: cleanText(o.start, 40),
      end: cleanText(o.end, 40),
      bullets: strings(o.bullets, LIMITS.bullets, LIMITS.bullet),
      description: cleanText(o.description, LIMITS.description),
    }),
  );

const education = (v: unknown): ResumeEducation[] =>
  entries(v, LIMITS.education, (o) =>
    compact({
      degree: cleanText(o.degree, LIMITS.short),
      institution: cleanText(o.institution, LIMITS.short),
      location: cleanText(o.location, LIMITS.short),
      start: cleanText(o.start, 40),
      end: cleanText(o.end, 40),
      details: cleanText(o.details, LIMITS.description),
      score: cleanText(o.score, 40),
    }),
  );

const skills = (v: unknown): ResumeSkillGroup[] =>
  entries(v, LIMITS.skillGroups, (o) => {
    const items = strings(o.items, LIMITS.skillItems, 80);
    return items.length ? compact({ category: cleanText(o.category, 80), items }) : undefined;
  });

const projects = (v: unknown): ResumeProject[] =>
  entries(v, LIMITS.projects, (o) =>
    compact({
      name: cleanText(o.name, LIMITS.short),
      description: cleanText(o.description, LIMITS.description),
      link: cleanUrl(o.link),
      tech: strings(o.tech, LIMITS.tech, 60),
      bullets: strings(o.bullets, LIMITS.bullets, LIMITS.bullet),
    }),
  );

const certifications = (v: unknown): ResumeCertification[] =>
  entries(v, LIMITS.certifications, (o) =>
    compact({
      name: cleanText(o.name, LIMITS.short),
      issuer: cleanText(o.issuer, LIMITS.short),
      date: cleanText(o.date, 40),
      link: cleanUrl(o.link),
    }),
  );

const languages = (v: unknown): ResumeLanguage[] =>
  entries(v, LIMITS.languages, (o) => compact({ name: cleanText(o.name, 60), level: cleanText(o.level, 60) }));

export function normaliseDocument(input: unknown): ResumeDocument {
  if (!isObject(input)) return {};
  return (
    compact<ResumeDocument>({
      personal: personal(input.personal),
      links: links(input.links),
      summary: cleanText(input.summary, LIMITS.summary),
      experience: experience(input.experience),
      education: education(input.education),
      skills: skills(input.skills),
      projects: projects(input.projects),
      certifications: certifications(input.certifications),
      languages: languages(input.languages),
      achievements: strings(input.achievements, LIMITS.achievements, LIMITS.medium),
    }) ?? {}
  );
}

/** True when the document has nothing a resume needs (no name, no summary, no entries). */
export function isEmptyDocument(doc: ResumeDocument): boolean {
  return Object.keys(doc).length === 0 || (!doc.summary && !doc.experience?.length && !doc.education?.length && !doc.skills?.length && !doc.projects?.length && !doc.personal?.fullName);
}

/** Request-body schema: any JSON object, normalised. Anything else is a 400. */
export const documentSchema = z
  .custom<Record<string, unknown>>((v) => isObject(v), { message: "must be an object" })
  .transform((v) => normaliseDocument(v));
