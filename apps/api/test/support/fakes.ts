/** Fake AI tasks and renderer for the resume tests: deterministic, recorded, switchable to fail. */
import type { AnalysisReport, ResumeDocument } from "@open-resume/types";
import type { AnalyzeResult, ResumeAiTasks } from "../../src/services/resume/ai-tasks";
import type { ResumeRenderer } from "../../src/services/resume/renderer";

const report = (score: number): AnalysisReport => ({
  score,
  summary: "ok",
  keywords: { matched: ["a"], missing: [] },
  formatting: "f",
  content: "c",
  readability: { score: 70, notes: "n" },
  strengths: ["s"],
  weaknesses: ["w"],
  repetitivePhrases: [],
  improvements: ["i"],
});

export function fakeAi() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const state = { failAnalyze: 0, failAlways: false, failMessage: "provider said: SECRET-PROVIDER-DETAIL" };
  const doc = (summary: string): ResumeDocument => ({ personal: { fullName: "Ada Lovelace" }, summary, experience: [{ title: "Engineer", bullets: ["Built things"] }] });
  const tasks: ResumeAiTasks = {
    async parseDocument(text) {
      calls.push({ fn: "parseDocument", args: [text] });
      return doc(text.slice(0, 80));
    },
    async analyze(document, job) {
      calls.push({ fn: "analyze", args: [document, job] });
      if (state.failAlways || state.failAnalyze-- > 0) throw new Error(state.failMessage);
      const result: AnalyzeResult = { before: report(50), improved: doc("improved"), after: report(81.4), coverLetter: { paragraphs: ["Dear team"] }, usage: { inputTokens: 1, outputTokens: 1, offline: true } };
      return result;
    },
    async interview(track) {
      calls.push({ fn: "interview", args: [track] });
      return [{ title: track, items: [{ question: "q", answer: "a" }] }];
    },
    async roadmap() {
      calls.push({ fn: "roadmap", args: [] });
      return { targetRole: "Staff", summary: "s", phases: [], certifications: [] };
    },
    async projects() {
      calls.push({ fn: "projects", args: [] });
      return [{ title: "p", description: "d", difficulty: "beginner", tech: ["x"], outcomes: ["o"], resumeBullet: "b" }];
    },
    async builderChat() {
      throw new Error("not used");
    },
  };
  return { tasks, calls, state, count: (fn: string) => calls.filter((c) => c.fn === fn).length };
}

export function fakeRenderer(): ResumeRenderer & { templates: string[] } {
  const templates: string[] = [];
  return {
    templates,
    listTemplates: () => [],
    resolveTemplate: (id) => {
      const t = (id ?? "modern_resume_template") as never;
      templates.push(String(t));
      return t;
    },
    renderHtml: async (_d, t) => `<html><body>resume ${t}</body></html>`,
    renderPdf: async (_d, t) => Buffer.from(`%PDF-fake ${t}`),
    renderDocx: async () => Buffer.from("docx-bytes"),
    renderCoverLetterPdf: async () => Buffer.from("%PDF-letter"),
    renderCoverLetterDocx: async () => Buffer.from("docx-letter"),
  };
}

export const RESUME_TEXT = `Ada Lovelace
Software Engineer
ada@example.com

Experience
Engineer at Analytical Engines Ltd, 2020 to 2024. Built the first programmable systems and led a team of five.

Skills
Mathematics, Programming, Leadership`;
