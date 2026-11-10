/** What the offline generators know about a candidate, derived from the document only. */
import type { ResumeDocument } from "@open-resume/types";
import { allBullets, allSkills, documentToText } from "../document";
import { roleFromJd } from "./letter";
import { yearsOfExperience } from "./improve";
import { termsIn } from "./lexicon";

export type Level = "entry" | "mid" | "senior";

export interface Profile {
  name?: string;
  /** The role they hold or hold out for. */
  role: string;
  company?: string;
  level: Level;
  years: number | null;
  skills: string[];
  /** Known technologies and skills found anywhere in the document. */
  terms: string[];
  bullets: string[];
  targetRole?: string;
  jd?: string;
  jobCompany?: string;
}

export function profileOf(doc: ResumeDocument, job: { jd?: string; company?: string } = {}, now = new Date()): Profile {
  const exp = doc.experience?.[0];
  const role = doc.personal?.headline || exp?.title || "professional";
  const years = yearsOfExperience(doc, now);
  const senior = /\b(senior|sr\.?|lead|principal|staff|head|director|manager|architect)\b/i.test(role);
  const entry = /\b(intern|junior|jr\.?|trainee|graduate|fresher|aspiring|entry|associate)\b/i.test(role);
  const level: Level = senior || (years !== null && years >= 6) ? "senior" : entry || (years !== null && years < 2) || !doc.experience?.length ? "entry" : "mid";
  return {
    name: doc.personal?.fullName,
    role,
    company: exp?.company,
    level,
    years,
    skills: allSkills(doc),
    terms: termsIn(documentToText(doc)),
    bullets: allBullets(doc),
    targetRole: roleFromJd(job.jd),
    jd: job.jd,
    jobCompany: job.company?.trim() || undefined,
  };
}
