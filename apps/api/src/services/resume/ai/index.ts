/**
 * The resume AI tasks (implements ResumeAiTasks). Each task resolves the admin-configured
 * text model once: with a model it runs the structured-output runner (JSON mode, zod,
 * one repair retry); with none it runs the deterministic offline engine. A configured
 * model that fails is an error (AiUnavailable / AiBadOutput), never a silent downgrade to
 * the offline engine, so the admin sees real provider problems.
 *
 * Guarantees on every path: inputs are capped, user text reaches a model only inside
 * untrusted blocks, the owner's contact details and photo survive a rewrite, and no resume
 * text, job description or token ever reaches a log line (only task names and counts).
 */
import type { BuilderChatRequest, BuilderChatResponse, CareerRoadmap, InterviewGroup, InterviewTrack, ProjectIdea, ResumeDocument } from "@open-resume/types";
import { logger } from "../../../core/logger";
import { resolveTextModel, type ResolvedModel } from "../../models.service";
import type { AiContext, AnalyzeResult, ResumeAiTasks, TargetJob } from "../ai-tasks";
import { fillMissingSections, hasContent, normalizeDocument, restoreOwnerFields } from "./document";
import { LIMITS, clip, oneLine } from "./limits";
import { chatOffline, analyzeOffline, coverLetterOffline, improveDocument, interviewOffline, parseResumeText, projectsOffline, roadmapOffline } from "./offline";
import * as prompts from "./prompts";
import { AiBadOutput, newUsage, runStructured, TIMEOUT_MS, type RunCtx, type UsageAcc } from "./runner";
import { analysisReportSchema, chatSchema, interviewSchema, parseSchema, projectsSchema, rewriteSchema, roadmapSchema } from "./schemas";

export { AiBadOutput, AiUnavailable, runStructured } from "./runner";
export * as schemas from "./schemas";

interface Session {
  usage: UsageAcc;
  model: ResolvedModel | null;
  run(timeoutMs?: number): RunCtx;
}

async function begin(ctx: AiContext, task: string): Promise<Session> {
  const model = await resolveTextModel(ctx.modelId);
  const usage = newUsage(!model);
  return { usage, model, run: (timeoutMs) => ({ ai: ctx, usage, model: model ?? undefined, timeoutMs, task }) };
}

function finish(task: string, ctx: AiContext, s: Session): void {
  logger.info({ task, userId: ctx.userId, offline: s.usage.offline, inputTokens: s.usage.inputTokens, outputTokens: s.usage.outputTokens, calls: s.usage.calls }, "resume ai task done");
}

function job(j: TargetJob): { jd?: string; company?: string } {
  const jd = clip(j.jd, LIMITS.jdChars);
  const company = oneLine(j.company, LIMITS.companyChars);
  return { ...(jd ? { jd } : {}), ...(company ? { company } : {}) };
}

export const resumeAiTasks: ResumeAiTasks = {
  async parseDocument(text, ctx) {
    const input = clip(text, LIMITS.resumeChars);
    if (input.length < 20) throw new AiBadOutput("There is no resume text to read.");
    const s = await begin(ctx, "parse");
    let doc: ResumeDocument;
    if (s.model) doc = (await runStructured(parseSchema, prompts.parsePrompt(input), s.run())).document;
    else doc = parseResumeText(input);
    if (!hasContent(doc)) throw new AiBadOutput("We could not find resume content in that text.");
    finish("parse", ctx, s);
    return doc;
  },

  async analyze(document, targetJob, ctx): Promise<AnalyzeResult> {
    const original = normalizeDocument(document);
    const j = job(targetJob);
    const s = await begin(ctx, "analyze");
    let result: Omit<AnalyzeResult, "usage">;
    if (s.model) {
      const [before, rewrite] = await Promise.all([
        runStructured(analysisReportSchema, prompts.analysisPrompt(original, j), s.run()),
        runStructured(rewriteSchema, prompts.rewritePrompt(original, j), s.run()),
      ]);
      const improved = fillMissingSections(restoreOwnerFields(rewrite.document, original), original);
      const after = await runStructured(analysisReportSchema, prompts.analysisAfterPrompt(improved, before, j), s.run());
      const header = { ...(rewrite.coverLetter.header ?? {}), name: original.personal?.fullName ?? rewrite.coverLetter.header?.name, email: original.personal?.email ?? rewrite.coverLetter.header?.email, phone: original.personal?.phone ?? rewrite.coverLetter.header?.phone, ...(j.company ? { company: j.company } : {}) };
      result = { before, improved, after, coverLetter: { ...rewrite.coverLetter, header } };
    } else {
      const improved = improveDocument(original, j);
      result = { before: analyzeOffline(original, j.jd), improved, after: analyzeOffline(improved, j.jd), coverLetter: coverLetterOffline(improved, j) };
    }
    finish("analyze", ctx, s);
    return { ...result, usage: { inputTokens: s.usage.inputTokens, outputTokens: s.usage.outputTokens, offline: s.usage.offline } };
  },

  async interview(track: InterviewTrack, document, targetJob, ctx): Promise<InterviewGroup[]> {
    const doc = normalizeDocument(document);
    const j = job(targetJob);
    const s = await begin(ctx, `interview_${track}`);
    const groups = s.model ? (await runStructured(interviewSchema, prompts.interviewPrompt(track, doc, j), s.run())).groups : interviewOffline(track, doc, j);
    finish(`interview_${track}`, ctx, s);
    return groups;
  },

  async roadmap(document, targetJob, ctx): Promise<CareerRoadmap> {
    const doc = normalizeDocument(document);
    const j = job(targetJob);
    const s = await begin(ctx, "roadmap");
    const out = s.model ? await runStructured(roadmapSchema, prompts.roadmapPrompt(doc, j), s.run()) : roadmapOffline(doc, j);
    finish("roadmap", ctx, s);
    return out;
  },

  async projects(document, targetJob, ctx): Promise<ProjectIdea[]> {
    const doc = normalizeDocument(document);
    const j = job(targetJob);
    const s = await begin(ctx, "projects");
    const out = s.model ? (await runStructured(projectsSchema, prompts.projectsPrompt(doc, j), s.run())).projects : projectsOffline(doc, j);
    finish("projects", ctx, s);
    return out;
  },

  async builderChat(req: BuilderChatRequest, ctx): Promise<BuilderChatResponse> {
    const messages = req.messages
      .slice(-LIMITS.chatMessages)
      .map((m) => ({ role: m.role, content: clip(m.content, LIMITS.chatMessageChars) }))
      .filter((m) => m.content);
    const current = normalizeDocument(req.document ?? {});
    const photo = current.personal?.photoDataUrl;
    const bounded: BuilderChatRequest = { messages, document: current };
    const s = await begin(ctx, "chat");
    let out: BuilderChatResponse;
    if (s.model) {
      out = await runStructured(chatSchema, prompts.chatPrompt(bounded), s.run(TIMEOUT_MS.chat));
    } else out = chatOffline(bounded);
    // The photo never passes through a model; the user's own copy is kept.
    out = { ...out, document: { ...out.document, personal: { ...(out.document.personal ?? {}), photoDataUrl: photo } } };
    finish("chat", ctx, s);
    return out;
  },
};
