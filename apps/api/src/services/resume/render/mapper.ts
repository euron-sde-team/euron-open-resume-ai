/**
 * Canonical `ResumeDocument` -> the shape the EJS templates were written against:
 *
 *   data.updatedResume = { personalInfo{name,email,phone,links[],location,title}, summary,
 *     skills[], coreCompetencies[], experience[{companyName,designation,duration,description[{point}]}],
 *     education[], projects[], achievements[{name,link,date}], languages[] }
 *
 * The mapper is deliberately tolerant (a section it cannot read becomes an empty section,
 * never a thrown error) and `normaliseResumeForTemplate` is the legacy normaliser ported on
 * top, so a differently shaped legacy object still renders. Links are filtered here AND
 * again by `safeHref` inside the templates.
 */
import type { CoverLetter, ResumeDocument } from "@open-resume/types";
import { cleanUrl } from "./safe";

export interface TemplatePoint {
  point: string;
}

const asString = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};

const asArray = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (v === null || v === undefined || v === "") return [];
  return [v as T];
};

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Bullet points however they were expressed: `{point}[]`, strings, one blob, or nothing. */
export const toPoints = (value: unknown): TemplatePoint[] => {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    const split = text
      .split(/\r?\n|(?:^|\s)[•·▪-]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return (split.length > 1 ? split : [text]).map((point) => ({ point }));
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return { point: entry.trim() };
        if (entry && typeof entry === "object") {
          const rec = entry as Record<string, unknown>;
          return { point: asString(rec.point ?? rec.text ?? rec.description ?? rec.value) };
        }
        return { point: asString(entry) };
      })
      .filter((p) => p.point.length > 0);
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const point = asString(rec.point ?? rec.text ?? rec.description);
    return point ? [{ point }] : [];
  }
  return [];
};

const toLinks = (value: unknown): string[] =>
  asArray<unknown>(value)
    .map((entry) => {
      if (typeof entry === "string") return cleanUrl(entry);
      if (entry && typeof entry === "object") {
        const rec = entry as Record<string, unknown>;
        return cleanUrl(asString(rec.url ?? rec.link ?? rec.href));
      }
      return undefined;
    })
    .filter((u): u is string => !!u);

const toAchievements = (value: unknown) =>
  asArray<unknown>(value)
    .map((entry) => {
      if (typeof entry === "string") return { name: entry.trim(), date: "", link: undefined as string | undefined };
      if (entry && typeof entry === "object") {
        const rec = entry as Record<string, unknown>;
        return {
          name: asString(rec.name ?? rec.title ?? rec.achievement),
          date: asString(rec.date),
          link: cleanUrl(asString(rec.link)),
        };
      }
      return { name: asString(entry), date: "", link: undefined };
    })
    .filter((a) => a.name.length > 0);

const toStringList = (value: unknown): string[] =>
  asArray<unknown>(value)
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object") {
        const rec = entry as Record<string, unknown>;
        return asString(rec.name ?? rec.title ?? rec.skill ?? rec.value);
      }
      return asString(entry);
    })
    .filter(Boolean);

const toLanguages = (value: unknown): { name: string; level: string }[] =>
  asArray<unknown>(value)
    .map((entry) => {
      if (typeof entry === "string") return { name: entry.trim(), level: "" };
      const rec = asRecord(entry);
      return { name: asString(rec.name ?? rec.language), level: asString(rec.level ?? rec.proficiency) };
    })
    .filter((l) => l.name.length > 0);

/**
 * Makes any resume-like object safe to render with every template. Never throws.
 * Ported from the legacy `normaliseResumeForTemplate`, plus links filtering and languages.
 */
export function normaliseResumeForTemplate(input: unknown): Record<string, unknown> {
  const resume = asRecord(input);
  const personal = asRecord(resume.personalInfo);
  const skills = resume.skills;
  return {
    ...resume,
    personalInfo: {
      ...personal,
      name: asString(personal.name),
      email: asString(personal.email),
      phone: asString(personal.phone),
      location: asString(personal.location),
      title: asString(personal.title),
      links: toLinks(personal.links),
    },
    summary: asString(resume.summary),
    skills: Array.isArray(skills) || typeof skills === "string" ? toStringList(skills) : toStringList(Object.values(asRecord(skills))),
    coreCompetencies: toStringList(resume.coreCompetencies),
    certifications: toStringList(resume.certifications),
    languages: toLanguages(resume.languages),
    achievements: toAchievements(resume.achievements),
    experience: asArray<Record<string, unknown>>(resume.experience).map((raw) => {
      const exp = asRecord(raw);
      return {
        ...exp,
        companyName: asString(exp.companyName ?? exp.company),
        designation: asString(exp.designation ?? exp.position ?? exp.role),
        duration: asString(exp.duration),
        location: asString(exp.location),
        link: cleanUrl(asString(exp.link)),
        description: toPoints(exp.description ?? exp.points ?? exp.responsibilities),
      };
    }),
    education: asArray<Record<string, unknown>>(resume.education).map((raw) => {
      const edu = asRecord(raw);
      return {
        ...edu,
        degree: asString(edu.degree),
        institution: asString(edu.institution ?? edu.school),
        duration: asString(edu.duration),
        location: asString(edu.location),
        description: asString(edu.description),
        link: cleanUrl(asString(edu.link)),
      };
    }),
    projects: asArray<Record<string, unknown>>(resume.projects).map((raw) => {
      const proj = asRecord(raw);
      return {
        ...proj,
        name: asString(proj.name ?? proj.title),
        duration: asString(proj.duration),
        link: cleanUrl(asString(proj.link)),
        technologiesUsed: toStringList(proj.technologiesUsed ?? proj.technologies ?? proj.tech),
        description: toPoints(proj.description ?? proj.points),
      };
    }),
  };
}

const range = (start?: string, end?: string): string => [start, end].map((s) => (s ?? "").trim()).filter(Boolean).join(" - ");

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
};

/** The canonical document in the legacy template shape (already normalised). */
export function toTemplateResume(doc: ResumeDocument | undefined | null): Record<string, unknown> {
  const d = asRecord(doc) as ResumeDocument;
  const p = asRecord(d.personal) as NonNullable<ResumeDocument["personal"]>;
  const l = asRecord(d.links) as NonNullable<ResumeDocument["links"]>;
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const links = [l.portfolio, l.github, l.linkedin, l.twitter, l.youtube, ...list<any>(l.other).map((o) => (typeof o === "string" ? o : o?.url))].filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0,
  );

  const skills = dedupe(list<any>(d.skills).flatMap((g) => list<string>(g?.items).map((s) => (s ?? "").trim())));

  const achievements = [
    ...list<any>(d.achievements).map((name) => ({ name: (name ?? "").trim(), link: undefined as string | undefined, date: "" })),
    // None of the templates has a certifications section, so they ride along as achievements.
    ...list<any>(d.certifications).map((c) => ({
      name: [c?.name, c?.issuer].map((s) => (s ?? "").trim()).filter(Boolean).join(", "),
      link: c?.link,
      date: (c?.date ?? "").trim(),
    })),
  ];

  const legacy = {
    personalInfo: {
      name: p.fullName ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      location: p.location ?? "",
      title: p.headline ?? "",
      links,
    },
    summary: d.summary ?? "",
    skills,
    coreCompetencies: [],
    languages: list<any>(d.languages).map((x) => ({ name: x?.name ?? "", level: x?.level ?? "" })),
    experience: list<any>(d.experience).map((e) => ({
      companyName: e?.company ?? "",
      designation: e?.title ?? "",
      duration: range(e?.start, e?.end),
      location: e?.location ?? "",
      description: [...(e?.description ? toPoints(e.description) : []), ...list<string>(e?.bullets).map((point) => ({ point }))],
    })),
    education: list<any>(d.education).map((e) => ({
      degree: e?.degree ?? "",
      institution: e?.institution ?? "",
      duration: range(e?.start, e?.end),
      location: e?.location ?? "",
      description: [e?.score ? `Score: ${e.score}` : "", e?.details ?? ""].filter(Boolean).join(". "),
    })),
    projects: list<any>(d.projects).map((pr) => ({
      name: pr?.name ?? "",
      duration: "",
      link: pr?.link,
      technologiesUsed: pr?.tech ?? [],
      description: [
        ...(pr?.description ? toPoints(pr.description) : []),
        ...list<string>(pr?.bullets).map((point) => ({ point })),
        ...(pr?.tech?.length ? [{ point: `Tech: ${pr.tech.join(", ")}` }] : []),
      ],
    })),
    achievements,
  };
  return normaliseResumeForTemplate(legacy);
}

/** The `data` object the resume templates receive. */
export function toResumeTemplateData(doc: ResumeDocument | undefined | null): { updatedResume: Record<string, unknown> } {
  return { updatedResume: toTemplateResume(doc) };
}

/**
 * The `data` object cover_letter.ejs receives. The author's details come from the resume
 * (the letter header only carries what the model wrote), the date falls back to today.
 */
export function toCoverLetterTemplateData(letter: CoverLetter | undefined | null, author: ResumeDocument | undefined | null) {
  const h = letter?.header ?? {};
  const p = author?.personal ?? {};
  return {
    coverLetter: {
      personalInfo: {
        name: asString(h.name) || asString(p.fullName) || "Applicant",
        email: asString(h.email) || asString(p.email),
        phone: asString(h.phone) || asString(p.phone),
        location: asString(h.location) || asString(p.location),
        title: asString(p.headline),
      },
      date: asString(h.date) || new Date().toISOString().slice(0, 10),
      recipient: { name: asString(h.recipient), title: "", company: asString(h.company), address: "" },
      greeting: asString(letter?.greeting),
      body: { paragraphs: (letter?.paragraphs ?? []).map(asString).filter(Boolean) },
      closing: asString(letter?.closing).replace(/[,\s]+$/, "") || "Sincerely",
    },
  };
}

/** Reverse mapper: a legacy template-shaped resume back into the canonical document. */
export function fromTemplateResume(input: unknown): ResumeDocument {
  const r = normaliseResumeForTemplate(input) as {
    personalInfo: { name: string; email: string; phone: string; location: string; title: string; links: string[] };
    summary: string;
    skills: string[];
    languages: { name: string; level: string }[];
    experience: { companyName: string; designation: string; duration: string; location: string; description: TemplatePoint[] }[];
    education: { degree: string; institution: string; duration: string; location: string; description: string }[];
    projects: { name: string; link?: string; technologiesUsed: string[]; description: TemplatePoint[] }[];
    achievements: { name: string; link?: string; date: string }[];
  };
  const split = (duration: string): { start?: string; end?: string } => {
    const [start, end] = duration.split(/\s+(?:-|–|to)\s+/i);
    return { start: start || undefined, end: end || undefined };
  };
  return {
    personal: {
      fullName: r.personalInfo.name,
      headline: r.personalInfo.title,
      email: r.personalInfo.email,
      phone: r.personalInfo.phone,
      location: r.personalInfo.location,
    },
    links: { other: r.personalInfo.links.map((url) => ({ url })) },
    summary: r.summary,
    experience: r.experience.map((e) => ({
      title: e.designation,
      company: e.companyName,
      location: e.location,
      ...split(e.duration),
      bullets: e.description.map((x) => x.point),
    })),
    education: r.education.map((e) => ({ degree: e.degree, institution: e.institution, location: e.location, ...split(e.duration), details: e.description })),
    skills: r.skills.length ? [{ category: "Skills", items: r.skills }] : [],
    projects: r.projects.map((pr) => ({ name: pr.name, link: pr.link, tech: pr.technologiesUsed, bullets: pr.description.map((x) => x.point) })),
    languages: r.languages,
    achievements: r.achievements.map((a) => a.name),
  };
}
