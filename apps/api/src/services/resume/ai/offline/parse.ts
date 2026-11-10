/**
 * Heuristic resume text -> ResumeDocument. No network, deterministic. It reads the layout
 * `documentToText` writes and the usual layouts of real resumes (section headings in any
 * case, `A | B | C | dates` or `Title at Company (dates)` entry lines, "-"/"•" bullets,
 * "Category: a, b" skill lines). It never invents anything: a field it cannot place is
 * left out. Limits: two-column PDFs interleave their columns before we see them, and
 * free-form prose with no headings yields a header plus whatever labelled lines exist.
 */
import type { ResumeCertification, ResumeDocument, ResumeEducation, ResumeExperience, ResumeLanguage, ResumeLinks, ResumePersonal, ResumeProject, ResumeSkillGroup } from "@open-resume/types";
import { normalizeDocument, safeUrl } from "../document";

// ─── Patterns ───────────────────────────────────────────────────────────────

type Section = "summary" | "experience" | "education" | "skills" | "projects" | "certifications" | "languages" | "achievements";

const HEADINGS: Record<Section, string[]> = {
  summary: ["summary", "professional summary", "career summary", "profile", "professional profile", "about", "about me", "objective", "career objective", "personal statement"],
  experience: ["experience", "work experience", "professional experience", "employment", "employment history", "work history", "career history", "relevant experience", "internships", "internship experience"],
  education: ["education", "academic background", "academics", "education and training", "academic qualifications", "qualifications"],
  skills: ["skills", "technical skills", "key skills", "core skills", "core competencies", "competencies", "skills and tools", "technologies", "tech stack", "tools and technologies", "areas of expertise"],
  projects: ["projects", "personal projects", "academic projects", "selected projects", "key projects", "side projects", "open source"],
  certifications: ["certifications", "certificates", "licenses", "licenses and certifications", "certifications and courses", "courses", "training"],
  languages: ["languages", "spoken languages", "language skills"],
  achievements: ["achievements", "awards", "honors", "honours", "awards and honors", "accomplishments", "publications", "awards and achievements", "activities", "volunteering"],
};

const HEADING_LOOKUP = new Map<string, Section>();
for (const [k, names] of Object.entries(HEADINGS) as [Section, string[]][]) for (const n of names) HEADING_LOOKUP.set(n, k);

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[/.](?:19|20)\\d{2}`;
const PRESENT = "present|current|now|ongoing|till date|to date|today";
const RANGE_RE = new RegExp(`[(\\[]?\\s*(${DATE})\\s*(?:-|\\u2013|\\u2014|to|until)\\s*(${DATE}|${PRESENT})\\s*[)\\]]?`, "i");
const SINGLE_DATE_RE = new RegExp(`[(\\[]?\\s*(${DATE})\\s*[)\\]]?`, "i");

const TITLE_RE = /\b(engineer|developer|manager|analyst|designer|lead|intern|consultant|director|architect|scientist|specialist|officer|head|associate|administrator|teacher|professor|assistant|coordinator|executive|president|founder|co-founder|technician|representative|nurse|accountant|programmer|researcher|writer|editor|strategist|supervisor|trainee|apprentice|owner|partner|advisor|freelance(?:r)?|tutor|clerk|agent|auditor|planner|buyer|recruiter|operator|mechanic|chef|driver|cashier)\b/i;
const DEGREE_RE = /\b(b\.?\s?sc?\.?|b\.?\s?a\.?|b\.?\s?e\.?|b\.?\s?tech|m\.?\s?sc?\.?|m\.?\s?a\.?|m\.?\s?e\.?|m\.?\s?tech|mba|ph\.?\s?d|bachelor(?:'s)?|master(?:'s)?|diploma|associate(?:'s)? degree|doctorate|high school|secondary|certificate in|bca|mca|llb|md|bba)\b/i;
const INSTITUTION_RE = /\b(university|college|institute|school|academy|polytechnic|universit[eéà]|iit|nit|bootcamp)\b/i;
const SCORE_RE = /\b(gpa|cgpa|grade|percentage|percent|score|cum laude|distinction|first class|honou?rs?)\b|\b\d{1,3}(?:\.\d+)?\s?%|\b\d(?:\.\d{1,2})?\s*\/\s*(?:4|5|10)(?:\.0+)?\b/i;
const BULLET_RE = /^\s*(?:[-*•●▪◦‣∙·➢➤►▸■□✓✔]|\d{1,2}[.)])\s+/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE = /(?:https?:\/\/|www\.)[^\s|,;]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|me|co|in|app|ai|tech|xyz)(?:\/[^\s|,;]*)?/i;

// ─── Helpers ────────────────────────────────────────────────────────────────

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/\f/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const stripBullet = (l: string): string => l.replace(BULLET_RE, "").trim();
const isBullet = (l: string): boolean => BULLET_RE.test(l);

/** Which section a line opens, with any text that followed "Heading: text" on the same line. */
export function headingOf(line: string, within?: Section | null): { section: Section; rest?: string } | null {
  const t = line.trim();
  if (!t || t.length > 80) return null;
  const plain = t.replace(/^[#*_\-=\s]+|[#*_\-=\s:]+$/g, "").replace(/\s*&\s*/g, " and ").toLowerCase();
  const direct = HEADING_LOOKUP.get(plain);
  if (direct && !/[.,;]$/.test(t)) return { section: direct };
  const labelled = /^([A-Za-z &]{3,40}?)\s*:\s+(\S.*)$/.exec(t);
  if (labelled) {
    const s = HEADING_LOOKUP.get(labelled[1]!.trim().replace(/\s*&\s*/g, " and ").toLowerCase());
    // Inside a skills section "Languages: ..." is a category, not a new section.
    if (s && (s === "skills" || s === "summary" || (s === "languages" && within !== "skills"))) return { section: s, rest: labelled[2] };
  }
  return null;
}

function splitDates(s: string, kind: "experience" | "education"): { rest: string; start?: string; end?: string } {
  const range = RANGE_RE.exec(s);
  if (range) {
    const end = /^(present|current|now|ongoing|till date|to date|today)$/i.test(range[2]!) ? "Present" : range[2]!.trim();
    return { rest: (s.slice(0, range.index) + " " + s.slice(range.index + range[0].length)).trim(), start: range[1]!.trim(), end };
  }
  const one = SINGLE_DATE_RE.exec(s);
  if (one) {
    const rest = (s.slice(0, one.index) + " " + s.slice(one.index + one[0].length)).trim();
    return kind === "education" ? { rest, end: one[1]!.trim() } : { rest, start: one[1]!.trim() };
  }
  return { rest: s };
}

const cleanPart = (s: string): string => s.replace(/^[\s,;:|\-\u2013\u2014@]+|[\s,;:|\-\u2013\u2014@]+$/g, "").replace(/\s+/g, " ").trim();

/** Split an entry header into its parts on `|`, spaced dashes, " at " and " @ " (commas only as a last resort). */
function headerParts(s: string): string[] {
  let parts = s.split(/\s*\|\s*|\s+[\u2013\u2014-]\s+|\s+@\s+|\s+at\s+/i).map(cleanPart).filter(Boolean);
  if (parts.length === 1) {
    const commas = s.split(/\s*,\s*/).map(cleanPart).filter(Boolean);
    if (commas.length >= 2 && commas.length <= 3) parts = commas;
  }
  return parts;
}

// ─── Header (name and contact) ──────────────────────────────────────────────

function looksLikeLocation(s: string): boolean {
  return /^[A-Z][\p{L} .'-]+,\s*[A-Z][\p{L} .'-]+(?:,\s*[A-Z][\p{L} .'-]+)?$/u.test(s) && !TITLE_RE.test(s);
}

function linkSlot(url: string): keyof ResumeLinks | "other" {
  if (/linkedin\.com/i.test(url)) return "linkedin";
  if (/github\.com/i.test(url)) return "github";
  if (/(?:^|\/\/|\.)(?:twitter\.com|x\.com)/i.test(url)) return "twitter";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "portfolio";
}

function parseHeader(lines: string[]): { personal: ResumePersonal; links: ResumeLinks } {
  const personal: ResumePersonal = {};
  const links: ResumeLinks = {};
  const leftovers: { text: string; fromContactLine: boolean }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const segs = line
      .replace(/\b(?:phone|mobile|mob|tel|telephone|email|e-mail|contact|location|address|linkedin|github|portfolio|website|web)\s*:\s*/gi, "")
      .split(/\s*[|•·●]\s*|\s{3,}|\s*;\s*/)
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    let contact = false;
    const rest: string[] = [];
    for (const seg of segs) {
      const email = EMAIL_RE.exec(seg);
      if (email) {
        personal.email ??= email[0];
        contact = true;
        const other = cleanPart(seg.replace(email[0], ""));
        if (other && !URL_RE.test(other)) rest.push(other);
        continue;
      }
      const digits = seg.replace(/\D/g, "");
      if (digits.length >= 7 && digits.length <= 15 && /^[+\d()\s.-]+$/.test(seg)) {
        personal.phone ??= seg;
        contact = true;
        continue;
      }
      const url = URL_RE.exec(seg);
      if (url && !/\s/.test(seg.trim())) {
        const u = safeUrl(url[0]);
        if (u) {
          const slot = linkSlot(u);
          if (slot !== "other" && !links[slot]) (links as Record<string, unknown>)[slot] = u;
          else (links.other ??= []).push({ url: u });
        }
        contact = true;
        continue;
      }
      rest.push(seg);
    }
    for (const r of rest) leftovers.push({ text: r, fromContactLine: contact });
  }
  const nameIdx = leftovers.findIndex((l) => !l.fromContactLine && /^[\p{L}][\p{L} .'-]{1,60}$/u.test(l.text) && l.text.split(/\s+/).length <= 5 && !TITLE_RE.test(l.text) && !headingOf(l.text));
  if (nameIdx !== -1) personal.fullName = leftovers[nameIdx]!.text;
  const after = leftovers.filter((_, i) => i !== nameIdx);
  for (const l of after) {
    if (!personal.location && (looksLikeLocation(l.text) || (l.fromContactLine && l.text.length <= 60 && !TITLE_RE.test(l.text)))) personal.location = l.text;
    else if (!personal.headline && l.text.length <= 120 && !/[.!?]$/.test(l.text)) personal.headline = l.text;
  }
  return { personal, links };
}

// ─── Experience ─────────────────────────────────────────────────────────────

interface Block {
  header: string[];
  bullets: string[];
  extra: string[];
}

/** Split lines into entries: header lines (before the first bullet), bullets, other text. */
function toBlocks(lines: string[], opts: { startsEntry?: (line: string, cur: Block) => boolean } = {}): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let breakNext = false;
  let lastWasBullet = false;
  for (const raw of lines) {
    if (!raw.trim()) {
      breakNext = true;
      continue;
    }
    if (isBullet(raw)) {
      cur ??= { header: [], bullets: [], extra: [] };
      if (!blocks.includes(cur)) blocks.push(cur);
      cur.bullets.push(stripBullet(raw));
      lastWasBullet = true;
      breakNext = false;
      continue;
    }
    const line = raw.trim();
    // A wrapped bullet: lower case continuation right after a bullet.
    if (cur && lastWasBullet && !breakNext && /^[a-z(]/.test(line) && !RANGE_RE.test(line)) {
      cur.bullets[cur.bullets.length - 1] += " " + line;
      continue;
    }
    const startsNew = !cur || (cur.bullets.length > 0 ? true : breakNext && cur.header.length > 0) || (opts.startsEntry?.(line, cur) ?? false);
    if (startsNew) {
      cur = { header: [line], bullets: [], extra: [] };
      blocks.push(cur);
    } else if (cur) {
      if (cur.header.length < 3 && !cur.extra.length && line.length <= 110 && !/[.!?]$/.test(line)) cur.header.push(line);
      else cur.extra.push(line);
    }
    lastWasBullet = false;
    breakNext = false;
  }
  return blocks;
}

function parseExperience(lines: string[]): ResumeExperience[] {
  return toBlocks(lines).map((b) => {
    const e: ResumeExperience = { bullets: b.bullets };
    const parts: string[] = [];
    for (const h of b.header) {
      const d = splitDates(h, "experience");
      if (d.start && !e.start) e.start = d.start;
      if (d.end && !e.end) e.end = d.end;
      parts.push(...headerParts(d.rest));
    }
    const titleIdx = parts.findIndex((p) => TITLE_RE.test(p));
    const ti = titleIdx === -1 ? 0 : titleIdx;
    e.title = parts[ti];
    const others = parts.filter((_, i) => i !== ti);
    e.company = others[0];
    if (others.length > 1) e.location = others.slice(1).join(", ");
    if (b.extra.length) e.description = b.extra.join(" ");
    return e;
  });
}

// ─── Education ──────────────────────────────────────────────────────────────

function parseEducation(lines: string[]): ResumeEducation[] {
  const out: ResumeEducation[] = [];
  let cur: ResumeEducation | null = null;
  let breakNext = false;
  for (const raw of lines) {
    if (!raw.trim()) {
      breakNext = true;
      continue;
    }
    const line = stripBullet(raw);
    const d = splitDates(line, "education");
    const parts = headerParts(d.rest);
    const hasDegree = parts.some((p) => DEGREE_RE.test(p));
    const hasInst = parts.some((p) => INSTITUTION_RE.test(p));
    const isScore = SCORE_RE.test(line) && !hasInst && !hasDegree && line.length <= 70;
    const headerish = hasDegree || hasInst || (!!d.start || !!d.end);
    if (isScore && cur) {
      cur.score = cur.score ? cur.score : line;
    } else if (headerish && (!cur || (hasDegree && cur.degree) || (hasInst && cur.institution) || (breakNext && cur.degree && cur.institution))) {
      cur = {};
      out.push(cur);
    } else if (!cur) {
      cur = {};
      out.push(cur);
    }
    if (isScore && cur === out.at(-1) && cur.score === line) {
      breakNext = false;
      continue;
    }
    if (headerish || (!cur.degree && !cur.institution)) {
      if (d.start && !cur.start) cur.start = d.start;
      if (d.end && !cur.end) cur.end = d.end;
      const unplaced: string[] = [];
      for (const p of parts) {
        if (DEGREE_RE.test(p) && !cur.degree) cur.degree = p;
        else if (INSTITUTION_RE.test(p) && !cur.institution) cur.institution = p;
        else unplaced.push(p);
      }
      for (const p of unplaced) {
        if (!cur.degree && !DEGREE_RE.test(p) && !cur.institution && !hasInst) cur.degree = p;
        else if (!cur.institution) cur.institution = p;
        else if (!cur.degree) cur.degree = p;
        else if (!cur.location) cur.location = p;
      }
    } else {
      cur.details = cur.details ? `${cur.details} ${line}` : line;
    }
    breakNext = false;
  }
  return out;
}

// ─── Skills, projects, certifications, languages ────────────────────────────

function splitItems(s: string): string[] {
  return s
    .split(/\s*[,;|•·●]\s*|\s+\/\s+/)
    .map((x) => x.replace(/^[-\u2013\u2014\s]+|[\s.]+$/g, "").trim())
    .filter((x) => x && x.length <= 60);
}

function parseSkills(lines: string[]): ResumeSkillGroup[] {
  const groups: ResumeSkillGroup[] = [];
  const loose: string[] = [];
  for (const raw of lines) {
    const line = stripBullet(raw);
    if (!line) continue;
    const labelled = /^([^:]{2,40}):\s*(.+)$/.exec(line);
    if (labelled && !/https?:/i.test(labelled[1]!)) {
      const items = splitItems(labelled[2]!);
      if (items.length) groups.push({ category: labelled[1]!.trim(), items });
    } else loose.push(...splitItems(line));
  }
  if (loose.length) groups.push({ category: "Skills", items: loose });
  return groups;
}

function parseProjects(lines: string[]): ResumeProject[] {
  const out: ResumeProject[] = [];
  const TECH = /^(?:tech(?:nologies)?|stack|tech stack|built with|tools|technologies used)\s*:\s*(.+)$/i;
  for (const b of toBlocks(lines)) {
    const p: ResumeProject = { bullets: b.bullets, tech: [] };
    const first = b.header[0] ?? "";
    const sep = /\s*\|\s*|\s+[\u2013\u2014-]\s+/.exec(first);
    if (sep) {
      const left = first.slice(0, sep.index).trim();
      const right = first.slice(sep.index + sep[0].length).trim();
      p.name = left;
      const u = URL_RE.exec(right);
      if (u && !/\s/.test(right)) p.link = safeUrl(u[0]);
      else p.description = right;
    } else {
      const u = URL_RE.exec(first);
      p.name = u && first.trim() === u[0] ? first : first.replace(URL_RE, "").trim() || first;
    }
    const desc: string[] = p.description ? [p.description] : [];
    for (const line of [...b.header.slice(1), ...b.extra]) {
      const t = TECH.exec(line);
      if (t) p.tech!.push(...splitItems(t[1]!));
      else if (URL_RE.test(line) && !/\s/.test(line)) p.link ??= safeUrl(line);
      else desc.push(line);
    }
    if (desc.length) p.description = desc.join(" ");
    out.push(p);
  }
  return out;
}

function parseCertifications(lines: string[]): ResumeCertification[] {
  const out: ResumeCertification[] = [];
  for (const raw of lines) {
    const line = stripBullet(raw);
    if (!line) continue;
    const link = URL_RE.exec(line);
    const noLink = link ? line.replace(link[0], "") : line;
    const d = splitDates(noLink, "experience");
    const parts = headerParts(d.rest);
    if (!parts[0]) continue;
    out.push({ name: parts[0], issuer: parts[1], date: d.start ?? d.end, link: link ? safeUrl(link[0]) : undefined });
  }
  return out;
}

function parseLanguages(lines: string[]): ResumeLanguage[] {
  const out: ResumeLanguage[] = [];
  for (const raw of lines) {
    for (const piece of stripBullet(raw).split(/\s*[,;|\n]\s*/)) {
      const m = /^([\p{L} ]{2,30}?)\s*(?:\(([^)]+)\)|[-:\u2013\u2014]\s*(.+))?$/u.exec(piece.trim());
      if (m?.[1]) out.push({ name: m[1].trim(), level: (m[2] ?? m[3])?.trim() });
    }
  }
  return out;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Parse resume text. Always returns a normalised document (possibly empty). */
export function parseResumeText(raw: string): ResumeDocument {
  const lines = normalizeText(raw).split("\n");
  const sections = new Map<Section, string[]>();
  const header: string[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const h = headingOf(line, current);
    if (h) {
      current = h.section;
      if (!sections.has(current)) sections.set(current, []);
      if (h.rest) sections.get(current)!.push(h.rest);
      continue;
    }
    if (current) sections.get(current)!.push(line);
    else header.push(line);
  }
  const { personal, links } = parseHeader(header.slice(0, 8));
  const get = (s: Section) => sections.get(s) ?? [];
  const summary = get("summary").map((l) => stripBullet(l)).filter(Boolean).join(" ");
  const doc: ResumeDocument = {
    personal,
    links,
    summary,
    experience: parseExperience(get("experience")),
    education: parseEducation(get("education")),
    skills: parseSkills(get("skills")),
    projects: parseProjects(get("projects")),
    certifications: parseCertifications(get("certifications")),
    languages: parseLanguages(get("languages")),
    achievements: get("achievements").map(stripBullet).filter(Boolean),
  };
  return normalizeDocument(doc);
}

export function looksLikeResume(text: string): boolean {
  const lines = normalizeText(text).split("\n");
  const headings = lines.filter((l) => headingOf(l)).length;
  return headings >= 2 || (lines.length >= 6 && lines.some((l) => EMAIL_RE.test(l)) && lines.some(isBullet));
}
