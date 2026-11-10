/**
 * ATS-style scoring from measurable signals only. The 100 points are split as:
 *   contact 15, sections 20, bullets 20 (count and length), action verbs 10,
 *   quantified results 15, keywords 15 (overlap with the job description, or breadth of
 *   skills when none is given), readability 5.
 * Every point comes from something counted in the document, so adding a number to a
 * bullet or a missing keyword the candidate truly has raises the score, and padding with
 * nothing does not. The report text names the measurements it used.
 */
import type { AnalysisReport, ResumeDocument } from "@open-resume/types";
import { allBullets, allSkills, documentToText } from "../document";
import { ACTION_VERBS, FILLER_OPENERS, STOPWORDS, hasTerm, jdKeywords, termsIn } from "./lexicon";

const words = (s: string): string[] => s.match(/[\p{L}\p{N}][\p{L}\p{N}'+#./-]*/gu) ?? [];
const firstWord = (s: string): string => (words(s)[0] ?? "").toLowerCase();
const QUANT = /\d|%|\$|€|£|¥|\b(?:doubled|tripled|halved)\b/;
const WEAK = /\b(responsible for|worked on|helped with|duties included|various|etc\.?|in charge of|tasked with)\b|(?:^|\s)(i|my|me)\s/i;

export interface Signals {
  contact: number;
  sections: number;
  bullets: number;
  verbs: number;
  quantified: number;
  keywords: number;
  readability: number;
  /** Raw counts the report quotes. */
  facts: {
    bulletCount: number;
    avgBulletWords: number;
    longBullets: number;
    shortBullets: number;
    verbShare: number;
    quantShare: number;
    weakBullets: number;
    skillCount: number;
    jdMatched: string[];
    jdMissing: string[];
    missingContact: string[];
    missingSections: string[];
    totalWords: number;
  };
}

const ramp = (value: number, full: number): number => Math.max(0, Math.min(1, value / full));

export function measure(doc: ResumeDocument, jd?: string): Signals {
  const p = doc.personal ?? {};
  const l = doc.links ?? {};
  const hasLink = !!(l.linkedin || l.github || l.portfolio || l.twitter || l.youtube || l.other?.length);
  const missingContact = [!p.fullName && "name", !p.email && "email", !p.phone && "phone", !p.location && "location", !hasLink && "a profile link"].filter(Boolean) as string[];
  const contact = (p.fullName ? 4 : 0) + (p.email ? 4 : 0) + (p.phone ? 3 : 0) + (p.location ? 2 : 0) + (hasLink ? 2 : 0);

  const hasExp = !!doc.experience?.length;
  const hasProj = !!doc.projects?.length;
  const sectionChecks: [string, boolean, number][] = [
    ["summary", !!doc.summary, 4],
    ["experience", hasExp || hasProj, 6],
    ["education", !!doc.education?.length, 4],
    ["skills", !!doc.skills?.length, 4],
    ["projects or certifications", hasProj || !!doc.certifications?.length || !!doc.achievements?.length, 2],
  ];
  const sections = sectionChecks.reduce((a, [, ok, w]) => a + (ok ? w : 0), 0);
  const missingSections = sectionChecks.filter(([, ok]) => !ok).map(([n]) => n);

  const bullets = allBullets(doc);
  const lens = bullets.map((b) => words(b).length);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const longBullets = lens.filter((n) => n > 35).length;
  const shortBullets = lens.filter((n) => n < 6).length;
  const goodLen = lens.length ? lens.filter((n) => n >= 6 && n <= 35).length / lens.length : 0;
  // Enough bullets (6 to fill the half) and mostly well sized ones (the other half).
  const bulletScore = 10 * ramp(bullets.length, 6) + 10 * goodLen * ramp(bullets.length, 3);

  const verbShare = bullets.length ? bullets.filter((b) => ACTION_VERBS.has(firstWord(b))).length / bullets.length : 0;
  const quantShare = bullets.length ? bullets.filter((b) => QUANT.test(b)).length / bullets.length : 0;
  const weakBullets = bullets.filter((b) => WEAK.test(b) || FILLER_OPENERS.some((f) => f.re.test(b))).length;

  const skills = allSkills(doc);
  const text = documentToText(doc);
  const lower = text.toLowerCase();
  let keywords: number;
  let matched: string[] = [];
  let missing: string[] = [];
  if (jd && jd.trim().length > 20) {
    const kws = jdKeywords(jd, 24);
    matched = kws.filter((k) => hasTerm(lower, k));
    missing = kws.filter((k) => !hasTerm(lower, k));
    keywords = kws.length ? 15 * (matched.length / kws.length) : 7.5;
  } else {
    matched = [...new Set([...skills.map((s) => s.toLowerCase()), ...termsIn(lower)])].slice(0, 30);
    keywords = 15 * ramp(skills.length, 10);
  }

  const totalWords = words(text).length;
  const sentenceLens = [...(doc.summary ? [doc.summary] : []), ...bullets].map((s) => words(s).length);
  const longSentences = sentenceLens.filter((n) => n > 40).length;
  const readability =
    5 *
    Math.max(
      0,
      1 - (bullets.length ? weakBullets / bullets.length : 0) * 0.6 - (sentenceLens.length ? longSentences / sentenceLens.length : 0) * 0.6 - (totalWords < 120 ? 0.3 : 0) - (totalWords > 1400 ? 0.2 : 0),
    );

  return {
    contact,
    sections,
    bullets: bulletScore,
    verbs: 10 * verbShare,
    quantified: 15 * ramp(quantShare, 0.5),
    keywords,
    readability,
    facts: { bulletCount: bullets.length, avgBulletWords: Math.round(avg), longBullets, shortBullets, verbShare, quantShare, weakBullets, skillCount: skills.length, jdMatched: matched, jdMissing: missing, missingContact, missingSections, totalWords },
  };
}

export const totalOf = (s: Signals): number => Math.round(s.contact + s.sections + s.bullets + s.verbs + s.quantified + s.keywords + s.readability);

/** The most repeated sentence openers and phrases (3+ uses). */
export function repetitive(doc: ResumeDocument): string[] {
  const bullets = allBullets(doc);
  const openers = new Map<string, number>();
  for (const b of bullets) {
    const w = firstWord(b);
    if (w.length > 2 && !STOPWORDS.has(w)) openers.set(w, (openers.get(w) ?? 0) + 1);
  }
  const out = [...openers.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([w, n]) => `"${w}" opens ${n} bullets`);
  const grams = new Map<string, number>();
  for (const b of bullets) {
    const w = words(b.toLowerCase());
    for (let i = 0; i + 2 < w.length; i++) {
      const g = w.slice(i, i + 3).join(" ");
      if (w.slice(i, i + 3).every((x) => STOPWORDS.has(x))) continue;
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
  }
  out.push(...[...grams.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, n]) => `"${g}" appears ${n} times`));
  return out.slice(0, 6);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The full report for one version of the resume. */
export function analyzeOffline(doc: ResumeDocument, jd?: string): AnalysisReport {
  const s = measure(doc, jd);
  const f = s.facts;
  const score = totalOf(s);
  const hasJd = !!(jd && jd.trim().length > 20);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const improvements: string[] = [];

  if (!f.missingContact.length) strengths.push("Complete contact details with a profile link.");
  else {
    weaknesses.push(`Contact block is missing ${f.missingContact.join(", ")}.`);
    improvements.push(`Add ${f.missingContact.join(", ")} to the top of the resume so recruiters and parsers can reach you.`);
  }
  if (!f.missingSections.length) strengths.push("All the sections an ATS looks for are present.");
  else {
    weaknesses.push(`No ${f.missingSections.join(", ")} section.`);
    improvements.push(`Add a ${f.missingSections[0]} section; applicant systems and recruiters scan for it first.`);
  }
  if (f.bulletCount >= 6) strengths.push(`${f.bulletCount} achievement bullets give enough evidence to read.`);
  else {
    weaknesses.push(`Only ${f.bulletCount} bullet${f.bulletCount === 1 ? "" : "s"} describe your work.`);
    improvements.push("Write 3 to 5 bullets for each recent role or project, each stating what you did and what changed.");
  }
  if (f.bulletCount && f.verbShare >= 0.7) strengths.push(`${pct(f.verbShare)} of bullets start with a strong action verb.`);
  else if (f.bulletCount) {
    weaknesses.push(`Only ${pct(f.verbShare)} of bullets start with an action verb.`);
    improvements.push("Start every bullet with a past-tense action verb (built, led, reduced, shipped) instead of a noun or a pronoun.");
  }
  if (f.bulletCount && f.quantShare >= 0.5) strengths.push(`${pct(f.quantShare)} of bullets carry a measurable result.`);
  else if (f.bulletCount) {
    weaknesses.push(`${pct(f.quantShare)} of bullets include a number, percentage or amount.`);
    improvements.push("Add a measurable result where it is true: size of the system, percent improvement, time saved, users or money affected.");
  }
  if (f.longBullets) {
    weaknesses.push(`${f.longBullets} bullet${f.longBullets === 1 ? " is" : "s are"} longer than 35 words.`);
    improvements.push("Split or trim bullets over 35 words; one idea per bullet reads faster.");
  }
  if (f.shortBullets) improvements.push(`${f.shortBullets} bullet${f.shortBullets === 1 ? " is" : "s are"} under 6 words; say what you did and the outcome.`);
  if (f.weakBullets) {
    weaknesses.push(`${f.weakBullets} bullet${f.weakBullets === 1 ? " uses" : "s use"} filler such as "responsible for", "worked on" or first person.`);
    improvements.push('Replace "responsible for" and "worked on" openers with the action you took.');
  }
  if (hasJd) {
    const total = f.jdMatched.length + f.jdMissing.length;
    if (total && f.jdMatched.length / total >= 0.6) strengths.push(`Covers ${f.jdMatched.length} of ${total} keywords found in the job description.`);
    if (f.jdMissing.length) {
      weaknesses.push(`Missing job description keywords: ${f.jdMissing.slice(0, 8).join(", ")}.`);
      improvements.push(`If you have real experience with ${f.jdMissing.slice(0, 4).join(", ")}, say so in a bullet or the skills section, using the job description's wording.`);
    }
  } else if (f.skillCount < 8) {
    weaknesses.push(`Only ${f.skillCount} skills are listed.`);
    improvements.push("List 8 to 15 relevant skills, grouped by category, using the standard names employers search for.");
  } else strengths.push(`${f.skillCount} skills listed.`);
  if (!doc.summary) improvements.push("Add a 2 to 4 sentence summary that names your role, strongest skills and the kind of work you want.");

  const rep = repetitive(doc);
  const readabilityScore = Math.round((s.readability / 5) * 100);
  return {
    score,
    summary: `Scored ${score} out of 100 from counted signals: contact ${Math.round(s.contact)}/15, sections ${Math.round(s.sections)}/20, bullets ${Math.round(s.bullets)}/20, action verbs ${Math.round(s.verbs)}/10, measurable results ${Math.round(s.quantified)}/15, keywords ${Math.round(s.keywords)}/15, readability ${Math.round(s.readability)}/5. ${score >= 75 ? "A solid, parseable resume." : score >= 55 ? "A reasonable base with clear gaps." : "It needs work before it will perform well in applicant systems."}`,
    keywords: {
      matched: f.jdMatched.slice(0, 40),
      missing: f.jdMissing.slice(0, 40),
      notes: hasJd ? `${f.jdMatched.length} of ${f.jdMatched.length + f.jdMissing.length} job description keywords appear in the resume.` : "No job description was given, so keywords show the skills detected in the resume.",
    },
    formatting: `${f.missingSections.length ? `Missing: ${f.missingSections.join(", ")}.` : "Standard sections are present."} ${f.totalWords} words in total${f.totalWords > 1400 ? ", which is long for most roles" : f.totalWords < 150 ? ", which is thin" : ""}.`,
    content: `${f.bulletCount} bullets, averaging ${f.avgBulletWords} words; ${pct(f.verbShare)} start with an action verb and ${pct(f.quantShare)} include a measurable result.`,
    readability: { score: readabilityScore, notes: f.weakBullets ? `${f.weakBullets} bullet(s) use filler openers or first person.` : "Bullets are direct and free of filler openers." },
    strengths: strengths.slice(0, 6),
    weaknesses: weaknesses.slice(0, 6),
    repetitivePhrases: rep,
    improvements: improvements.slice(0, 8),
  };
}
