/**
 * The seam between the resume pipeline (jobs, quotas, storage) and the AI work.
 *
 * The pipeline hands over plain data and gets plain data back: no files, no HTTP, no
 * provider details cross this line. The implementation (services/resume/ai/*) resolves
 * the admin-configured model, falls back to the deterministic offline engine when none is
 * configured, validates every result against a schema and retries once on a bad answer.
 */
import type {
  AnalysisReport,
  BuilderChatRequest,
  BuilderChatResponse,
  CareerRoadmap,
  CoverLetter,
  InterviewGroup,
  InterviewTrack,
  ProjectIdea,
  ResumeDocument,
} from "@open-resume/types";

export interface AiContext {
  userId: string;
  /** A specific admin-configured model id, when the caller asked for one. */
  modelId?: string;
  signal?: AbortSignal;
}

export interface TargetJob {
  /** Job description text, already length-capped; never an instruction to the model. */
  jd?: string;
  company?: string;
}

export interface AnalyzeResult {
  before: AnalysisReport;
  improved: ResumeDocument;
  after: AnalysisReport;
  coverLetter: CoverLetter;
  /** Token usage across the calls, for the admin usage view. */
  usage: { inputTokens: number; outputTokens: number; offline: boolean };
}

export interface ResumeAiTasks {
  /** Turn extracted resume text (PDF/DOCX/TXT) into the canonical document. */
  parseDocument(text: string, ctx: AiContext): Promise<ResumeDocument>;
  /** Analyse the original, rewrite it ATS-style (tailored when a job is given), analyse the rewrite, write the cover letter. */
  analyze(document: ResumeDocument, job: TargetJob, ctx: AiContext): Promise<AnalyzeResult>;
  interview(track: InterviewTrack, document: ResumeDocument, job: TargetJob, ctx: AiContext): Promise<InterviewGroup[]>;
  roadmap(document: ResumeDocument, job: TargetJob, ctx: AiContext): Promise<CareerRoadmap>;
  projects(document: ResumeDocument, job: TargetJob, ctx: AiContext): Promise<ProjectIdea[]>;
  /** Chat builder: merge the conversation into the document and say what to do next. */
  builderChat(req: BuilderChatRequest, ctx: AiContext): Promise<BuilderChatResponse>;
}
