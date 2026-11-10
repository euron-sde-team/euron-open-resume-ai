/**
 * Zod schemas for every structured model answer. They are tolerant of harmless drift
 * (numbers as strings, a lone string for a list, "easy" for "beginner") and strict about
 * what matters (a score must be a number, a question needs an answer). The same schemas
 * validate the offline engine's output in the tests, so both paths return one shape.
 */
import type { AnalysisReport, BuilderChatResponse, CareerRoadmap, CoverLetter, InterviewGroup, ProjectIdea, ResumeDocument } from "@open-resume/types";
import { z } from "zod";
import { documentSchema, hasContent, text, textList } from "./document";

const score = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace("%", "")) : v), z.number().finite()).transform((n) => Math.max(0, Math.min(100, Math.round(n))));

const notes = text(1500);

export const analysisReportSchema: z.ZodType<AnalysisReport, z.ZodTypeDef, unknown> = z
  .object({
    score,
    summary: text(1500),
    keywords: z
      .object({ matched: textList(60, 80), missing: textList(60, 80), notes: text(600) })
      .catch({ matched: [], missing: [], notes: undefined }),
    formatting: notes,
    content: notes,
    readability: z.object({ score: score.optional(), notes }).catch({ score: undefined, notes: undefined }),
    strengths: textList(12, 400),
    weaknesses: textList(12, 400),
    repetitivePhrases: textList(15, 120),
    improvements: textList(15, 400),
  })
  .transform((r) => ({
    score: r.score,
    summary: r.summary ?? "",
    keywords: { matched: r.keywords.matched, missing: r.keywords.missing, ...(r.keywords.notes ? { notes: r.keywords.notes } : {}) },
    formatting: r.formatting ?? "",
    content: r.content ?? "",
    readability: { score: r.readability.score ?? r.score, notes: r.readability.notes ?? "" },
    strengths: r.strengths,
    weaknesses: r.weaknesses,
    repetitivePhrases: r.repetitivePhrases,
    improvements: r.improvements,
  }));

export const coverLetterSchema: z.ZodType<CoverLetter, z.ZodTypeDef, unknown> = z
  .object({
    header: z
      .object({ name: text(120), email: text(200), phone: text(60), location: text(160), date: text(40), recipient: text(160), company: text(160) })
      .optional()
      .catch(undefined),
    greeting: text(200),
    paragraphs: textList(8, 2500),
    closing: text(200),
  })
  .refine((c) => c.paragraphs.length > 0, { message: "paragraphs must contain at least one paragraph", path: ["paragraphs"] })
  .transform((c) => ({ ...(c.header ? { header: c.header } : {}), ...(c.greeting ? { greeting: c.greeting } : {}), paragraphs: c.paragraphs, ...(c.closing ? { closing: c.closing } : {}) }));

/** rewrite: the improved document and the cover letter in one answer. */
export const rewriteSchema = z
  .object({ document: documentSchema, coverLetter: coverLetterSchema })
  .refine((r) => hasContent(r.document), { message: "document is empty", path: ["document"] });
export type RewriteOutput = { document: ResumeDocument; coverLetter: CoverLetter };

/** parse: tolerate a bare document in place of `{ document }`. */
export const parseSchema = z
  .preprocess((v) => {
    if (v && typeof v === "object" && !("document" in v) && ("personal" in v || "experience" in v || "education" in v || "skills" in v)) return { document: v };
    return v;
  }, z.object({ document: documentSchema }))
  .refine((r) => hasContent(r.document), { message: "document is empty: extract the resume content from the text", path: ["document"] });

const qa = z.object({ question: text(600), answer: text(6000) }).transform((x) => (x.question && x.answer ? { question: x.question, answer: x.answer } : undefined));
const group = z
  .object({ title: text(120), items: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(qa.catch(undefined))).transform((a) => a.filter((x): x is { question: string; answer: string } => !!x)) })
  .transform((g) => (g.title && g.items.length ? { title: g.title, items: g.items } : undefined));

export const interviewSchema: z.ZodType<{ groups: InterviewGroup[] }, z.ZodTypeDef, unknown> = z
  .object({ groups: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(group.catch(undefined))) })
  .transform((r) => ({ groups: r.groups.filter((g): g is InterviewGroup => !!g) }))
  .refine((r) => r.groups.length > 0, { message: "groups must contain at least one group with questions and answers", path: ["groups"] });

const phase = z
  .object({ title: text(160), timeframe: text(80), goals: textList(10, 300), skills: textList(15, 100), resources: textList(10, 300) })
  .transform((p) => (p.title ? { title: p.title, timeframe: p.timeframe ?? "", goals: p.goals, skills: p.skills, resources: p.resources } : undefined));

export const roadmapSchema: z.ZodType<CareerRoadmap, z.ZodTypeDef, unknown> = z
  .object({ targetRole: text(160), summary: text(1500), phases: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(phase.catch(undefined))), certifications: textList(10, 200) })
  .transform((r) => ({ targetRole: r.targetRole ?? "", summary: r.summary ?? "", phases: r.phases.filter((p): p is NonNullable<typeof p> => !!p), certifications: r.certifications }))
  .refine((r) => r.targetRole.length > 0 && r.phases.length > 0, { message: "targetRole and at least one phase are required", path: ["phases"] });

const difficulty = z.preprocess((v) => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (["easy", "beginner", "junior", "low"].includes(s)) return "beginner";
  if (["medium", "intermediate", "moderate"].includes(s)) return "intermediate";
  if (["hard", "advanced", "expert", "senior"].includes(s)) return "advanced";
  return s;
}, z.enum(["beginner", "intermediate", "advanced"]));

const idea = z
  .object({ title: text(160), description: text(2500), difficulty, tech: textList(15, 60), outcomes: textList(10, 300), resumeBullet: text(500) })
  .transform((p) => (p.title && p.description ? { title: p.title, description: p.description, difficulty: p.difficulty, tech: p.tech, outcomes: p.outcomes, resumeBullet: p.resumeBullet ?? "" } : undefined));

export const projectsSchema: z.ZodType<{ projects: ProjectIdea[] }, z.ZodTypeDef, unknown> = z
  .object({ projects: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(idea.catch(undefined))) })
  .transform((r) => ({ projects: r.projects.filter((p): p is ProjectIdea => !!p) }))
  .refine((r) => r.projects.length > 0, { message: "projects must contain at least one project", path: ["projects"] });

export const chatSchema: z.ZodType<BuilderChatResponse, z.ZodTypeDef, unknown> = z
  .object({
    assistant_message: text(2000),
    document: documentSchema,
    next_prompts: textList(5, 80),
  })
  .refine((r) => !!r.assistant_message, { message: "assistant_message is required", path: ["assistant_message"] })
  .transform((r) => ({ assistant: r.assistant_message ?? "", document: r.document, nextPrompts: r.next_prompts }));
