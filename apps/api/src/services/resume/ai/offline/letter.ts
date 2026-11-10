/**
 * Offline cover letter: built from the document, the company and the job description,
 * using the candidate's own bullets verbatim. No achievement is invented and no country,
 * salary or date is assumed.
 */
import type { CoverLetter, ResumeDocument } from "@open-resume/types";
import { allSkills } from "../document";
import { ACTION_VERBS, hasTerm, jdKeywords, lowerFirst } from "./lexicon";

/** The role a job description is for: a labelled line, else a short first line. */
export function roleFromJd(jd?: string): string | undefined {
  if (!jd) return undefined;
  const labelled = /^\s*(?:job\s*title|position|role|title|vacancy)\s*[:-]\s*(.{3,80})$/im.exec(jd);
  if (labelled) return labelled[1]!.trim();
  const first = jd.split("\n").map((l) => l.trim()).find(Boolean);
  if (first && first.length <= 70 && !/[.!?]$/.test(first) && /\b(engineer|developer|manager|analyst|designer|lead|intern|consultant|director|architect|scientist|specialist|officer|administrator|teacher|coordinator|executive|associate|assistant|representative|nurse|accountant|writer|marketer)\b/i.test(first)) return first;
  return undefined;
}

const startsWithPastVerb = (b: string): boolean => ACTION_VERBS.has((b.split(/\s+/)[0] ?? "").toLowerCase());

export function coverLetterOffline(doc: ResumeDocument, job: { jd?: string; company?: string }): CoverLetter {
  const p = doc.personal ?? {};
  const exp = doc.experience?.[0];
  const company = job.company?.trim();
  const role = roleFromJd(job.jd);
  const headline = p.headline || exp?.title;
  const skills = allSkills(doc);

  const paragraphs: string[] = [];
  paragraphs.push(
    `I am writing to apply for ${role ? `the ${role} role` : "a role on your team"}${company ? ` at ${company}` : ""}. ${headline ? `I work as ${/^[aeiou]/i.test(headline) ? "an" : "a"} ${headline}` : "I bring a practical background"}${skills.length ? `, with hands-on experience in ${skills.slice(0, 4).join(", ")}` : ""}, and I would like to put that to work for ${company ?? "your team"}.`,
  );

  const bullets = (exp?.bullets ?? []).slice(0, 2);
  if (exp && bullets.length) {
    const where = exp.company ? ` at ${exp.company}` : "";
    const lead = `In my ${exp.title ? `${exp.title} role` : "most recent role"}${where}, `;
    const body = bullets.map((b, i) => (startsWithPastVerb(b) ? `${i ? "I also " : "I "}${lowerFirst(b).replace(/[.]+$/, "")}` : `${i ? "Also: " : "Highlights: "}${b.replace(/[.]+$/, "")}`));
    paragraphs.push(`${lead}${body.join(". ")}.`);
  } else if (doc.projects?.[0]) {
    const pr = doc.projects[0];
    paragraphs.push(`One project I am proud of is ${pr.name}${pr.description ? `: ${pr.description.replace(/[.]+$/, "")}` : ""}.`);
  }

  if (job.jd && job.jd.trim().length > 20) {
    const lower = JSON.stringify(doc).toLowerCase();
    const shared = jdKeywords(job.jd, 24).filter((k) => hasTerm(lower, k)).slice(0, 6);
    if (shared.length) paragraphs.push(`Your description asks for ${shared.length > 1 ? "skills such as" : "experience with"} ${shared.join(", ")}. These are areas I have worked in, and I am keen to apply them to the problems your team is solving.`);
  } else if (skills.length > 4) {
    paragraphs.push(`Beyond ${skills.slice(0, 2).join(" and ")}, I work with ${skills.slice(2, 6).join(", ")}, and I learn new tools quickly when a project needs them.`);
  }

  paragraphs.push(`Thank you for your time and consideration. I would welcome the chance to discuss how I can contribute${company ? ` to ${company}` : ""}.`);

  return {
    header: { name: p.fullName, email: p.email, phone: p.phone, location: p.location, company },
    greeting: company ? `Dear ${company} Hiring Team,` : "Dear Hiring Manager,",
    paragraphs,
    closing: "Sincerely,",
  };
}
