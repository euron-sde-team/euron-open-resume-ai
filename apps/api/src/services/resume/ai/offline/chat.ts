/**
 * Offline builder chat: merges what the user typed into the current document and asks for
 * the next missing piece. It understands pasted resumes (via the parser), contact details
 * and links anywhere in a message, "my name is ...", and "skills: ..." lines. It does not
 * understand free prose about a job ("I worked at X for three years"): it says what it
 * still needs instead of guessing.
 */
import type { BuilderChatRequest, BuilderChatResponse, ResumeDocument } from "@open-resume/types";
import { normalizeDocument, safeUrl } from "../document";
import { looksLikeResume, parseResumeText } from "./parse";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?<![\w/])\+?\d[\d\s().-]{7,17}\d(?![\w/])/;
const URLS = /(?:https?:\/\/|www\.)[^\s,;]+|\b(?:linkedin\.com|github\.com)\/[^\s,;]+/gi;

/** Union two lists of entries by a key, keeping the base order and entry data. */
function union<T>(base: T[] | undefined, incoming: T[] | undefined, key: (x: T) => string, merge?: (a: T, b: T) => T): T[] {
  const out = [...(base ?? [])];
  for (const x of incoming ?? []) {
    const k = key(x).toLowerCase();
    const i = out.findIndex((y) => key(y).toLowerCase() === k);
    if (i === -1) out.push(x);
    else if (merge) out[i] = merge(out[i]!, x);
  }
  return out;
}

const fill = <T extends object>(a: T, b: T): T => {
  const out = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    const empty = cur === undefined || cur === "" || (Array.isArray(cur) && cur.length === 0);
    if (empty && v !== undefined) out[k] = v;
  }
  return out as T;
};

/** Merge `incoming` into `base`: scalars fill gaps, lists add what is new. Nothing is dropped. */
export function mergeDocuments(base: ResumeDocument, incoming: ResumeDocument): ResumeDocument {
  return normalizeDocument({
    personal: fill(base.personal ?? {}, incoming.personal ?? {}),
    links: { ...fill(base.links ?? {}, incoming.links ?? {}), other: union(base.links?.other, incoming.links?.other, (x) => x.url ?? "") },
    summary: base.summary || incoming.summary,
    experience: union(base.experience, incoming.experience, (e) => `${e.title}|${e.company}`, fill),
    education: union(base.education, incoming.education, (e) => `${e.degree}|${e.institution}`, fill),
    skills: mergeSkills(base.skills, incoming.skills),
    projects: union(base.projects, incoming.projects, (x) => x.name ?? "", fill),
    certifications: union(base.certifications, incoming.certifications, (x) => x.name ?? ""),
    languages: union(base.languages, incoming.languages, (x) => x.name ?? ""),
    achievements: union(base.achievements, incoming.achievements, (x) => x),
  });
}

function mergeSkills(a: ResumeDocument["skills"], b: ResumeDocument["skills"]): ResumeDocument["skills"] {
  const out = (a ?? []).map((g) => ({ ...g, items: [...(g.items ?? [])] }));
  for (const g of b ?? []) {
    const target = out.find((x) => (x.category ?? "").toLowerCase() === (g.category ?? "").toLowerCase());
    const seen = new Set(out.flatMap((x) => x.items.map((i) => i.toLowerCase())));
    const fresh = (g.items ?? []).filter((i) => !seen.has(i.toLowerCase()));
    if (!fresh.length) continue;
    if (target) target.items.push(...fresh);
    else out.push({ category: g.category, items: fresh });
  }
  return out;
}

/** Facts that can be read from one short message. */
function fromMessage(msg: string): ResumeDocument {
  const doc: ResumeDocument = { personal: {}, links: {} };
  const email = EMAIL.exec(msg);
  if (email) doc.personal!.email = email[0];
  const noUrls = msg.replace(URLS, " ");
  const phone = PHONE.exec(noUrls.replace(EMAIL, " "));
  if (phone) doc.personal!.phone = phone[0].trim();
  for (const u of msg.match(URLS) ?? []) {
    const url = safeUrl(u.replace(/[.)]+$/, ""));
    if (!url) continue;
    if (/linkedin\.com/i.test(url)) doc.links!.linkedin = url;
    else if (/github\.com/i.test(url)) doc.links!.github = url;
    else doc.links!.portfolio = url;
  }
  const name = /\b(?:my name is|i am|i'm|this is)\s+([\p{L}][\p{L} .'-]{1,50}?)(?=[,.;!\n]|\s+and\b|\s+(?:from|based|living|working)\b|$)/iu.exec(msg);
  if (name && name[1]!.split(/\s+/).length <= 4 && !/\b(a|an|the|looking|applying|seeking)\b/i.test(name[1]!)) doc.personal!.fullName = name[1]!.trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  const skills = /(?:^|\n)\s*(?:my\s+)?skills?\s*(?:are|include)?\s*[:-]\s*(.+)/i.exec(msg);
  if (skills) {
    const items = skills[1]!.split(/\s*[,;|]\s*/).map((s) => s.trim()).filter(Boolean);
    if (items.length) doc.skills = [{ category: "Skills", items }];
  }
  const loc = /\b(?:i(?:'m| am)?\s+(?:based|living)\s+in|located in|location:)\s+([\p{L}][\p{L} .,'-]{2,60})/iu.exec(msg);
  if (loc) doc.personal!.location = loc[1]!.trim().replace(/[.]+$/, "");
  const head = /\b(?:i am|i'm)\s+an?\s+([\p{L} /&-]{3,60}?)(?=[,.;!\n]|\s+(?:with|based|living|looking)\b|$)/iu.exec(msg);
  if (head && /\b(engineer|developer|designer|analyst|manager|teacher|scientist|consultant|nurse|accountant|writer|marketer|student|graduate|intern)\b/i.test(head[1]!)) doc.personal!.headline = head[1]!.trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return doc;
}

interface Missing {
  key: string;
  ask: string;
  prompt: string;
}

function missingOf(d: ResumeDocument): Missing[] {
  const p = d.personal ?? {};
  const l = d.links ?? {};
  const list: Missing[] = [];
  if (!p.fullName) list.push({ key: "name", ask: "What is your full name?", prompt: "My name is ..." });
  if (!p.email || !p.phone) list.push({ key: "contact", ask: "What email address and phone number should recruiters use?", prompt: "Add contact details" });
  if (!p.headline) list.push({ key: "headline", ask: "What role are you aiming for, in a few words?", prompt: "Add a headline" });
  if (!d.experience?.length) list.push({ key: "experience", ask: "Paste or describe your most recent job: title, company, dates and what you did.", prompt: "Add work experience" });
  if (!d.education?.length) list.push({ key: "education", ask: "Where did you study, and what did you earn there?", prompt: "Add education" });
  if (!d.skills?.length) list.push({ key: "skills", ask: "Which skills should the resume show? You can send them as a comma-separated list.", prompt: "Add skills" });
  if (!d.summary) list.push({ key: "summary", ask: "Would you like a short professional summary? Tell me what you want to be known for.", prompt: "Write a summary" });
  if (!l.linkedin && !l.github && !l.portfolio) list.push({ key: "links", ask: "Do you have a profile link such as LinkedIn, GitHub or a portfolio?", prompt: "Add a profile link" });
  if (!d.projects?.length) list.push({ key: "projects", ask: "Any projects worth showing? Name, what it does and the tools used.", prompt: "Add a project" });
  return list;
}

function captured(before: ResumeDocument, after: ResumeDocument): string[] {
  const n = (d: ResumeDocument) => ({
    contact: [d.personal?.email, d.personal?.phone, d.personal?.fullName, d.personal?.location, d.personal?.headline].filter(Boolean).length,
    experience: d.experience?.length ?? 0,
    education: d.education?.length ?? 0,
    skills: (d.skills ?? []).reduce((a, g) => a + (g.items?.length ?? 0), 0),
    projects: d.projects?.length ?? 0,
    links: Object.values(d.links ?? {}).filter((v) => (Array.isArray(v) ? v.length : !!v)).length,
    summary: d.summary ? 1 : 0,
    certifications: d.certifications?.length ?? 0,
  });
  const a = n(before);
  const b = n(after);
  const out: string[] = [];
  if (b.contact > a.contact) out.push("your contact details");
  if (b.experience > a.experience) out.push(`${b.experience - a.experience} job${b.experience - a.experience > 1 ? "s" : ""}`);
  if (b.education > a.education) out.push("your education");
  if (b.skills > a.skills) out.push(`${b.skills - a.skills} skill${b.skills - a.skills > 1 ? "s" : ""}`);
  if (b.projects > a.projects) out.push(`${b.projects - a.projects} project${b.projects - a.projects > 1 ? "s" : ""}`);
  if (b.links > a.links) out.push("your links");
  if (b.summary > a.summary) out.push("a summary");
  if (b.certifications > a.certifications) out.push("certifications");
  return out;
}

export function chatOffline(req: BuilderChatRequest): BuilderChatResponse {
  const base = normalizeDocument(req.document ?? {});
  const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let merged = base;
  if (last.trim()) {
    const parsed = looksLikeResume(last) ? parseResumeText(last) : normalizeDocument({});
    merged = mergeDocuments(mergeDocuments(base, parsed), normalizeDocument(fromMessage(last)));
    // A plain "Summary" reply when a summary was just asked for.
    const asked = [...req.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
    if (!merged.summary && /professional summary/i.test(asked) && last.trim().length >= 40 && last.trim().length <= 800 && !looksLikeResume(last)) merged = { ...merged, summary: last.trim() };
  }
  const got = captured(base, merged);
  const miss = missingOf(merged);
  const next = miss[0];
  const lead = got.length ? `Got it: I added ${got.join(", ")}.` : last.trim() ? "I could not read new details from that message." : "Let's build your resume.";
  const assistant = next ? `${lead} ${next.ask}` : `${lead} Your resume has every main section. You can refine any bullet, or analyse it for a score.`;
  return { assistant, document: merged, nextPrompts: miss.slice(0, 4).map((m) => m.prompt).concat(next ? [] : ["Tighten my bullets", "Analyse my resume"]) };
}
