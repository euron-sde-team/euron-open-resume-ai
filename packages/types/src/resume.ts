/**
 * Resume AI contract: the canonical resume document, the analysis results and the
 * resume/draft/template DTOs. Timestamps are ISO-8601 strings, ids are ULIDs.
 *
 * `ResumeDocument` is the one shape every part of the product speaks: the builder, the
 * parsed upload, the AI-improved resume, the drafts, the 13 templates (through a mapper)
 * and the DOCX builder. All of its fields are optional because uploads and AI output are
 * messy; the API normalises (trims, drops empties, caps sizes) before storing.
 */

// ─── Canonical document ─────────────────────────────────────────────────────

export interface ResumeLinks {
  portfolio?: string;
  github?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
  other?: { label?: string; url?: string }[];
}

export interface ResumePersonal {
  fullName?: string;
  /** e.g. "Senior Frontend Engineer". */
  headline?: string;
  email?: string;
  phone?: string;
  location?: string;
  /** `data:image/(png|jpeg|gif);base64,...` only; anything else is dropped by the API. */
  photoDataUrl?: string;
}

export interface ResumeExperience {
  title?: string;
  company?: string;
  location?: string;
  /** Free-form: "Jan 2024", "2022". */
  start?: string;
  /** Free-form, or "Present". */
  end?: string;
  bullets?: string[];
  description?: string;
}

export interface ResumeEducation {
  degree?: string;
  institution?: string;
  location?: string;
  start?: string;
  end?: string;
  details?: string;
  score?: string;
}

export interface ResumeSkillGroup {
  category?: string;
  items?: string[];
}

export interface ResumeProject {
  name?: string;
  description?: string;
  link?: string;
  tech?: string[];
  bullets?: string[];
}

export interface ResumeCertification {
  name?: string;
  issuer?: string;
  date?: string;
  link?: string;
}

export interface ResumeLanguage {
  name?: string;
  level?: string;
}

export interface ResumeDocument {
  personal?: ResumePersonal;
  links?: ResumeLinks;
  summary?: string;
  experience?: ResumeExperience[];
  education?: ResumeEducation[];
  skills?: ResumeSkillGroup[];
  projects?: ResumeProject[];
  certifications?: ResumeCertification[];
  languages?: ResumeLanguage[];
  achievements?: string[];
}

// ─── Templates ──────────────────────────────────────────────────────────────

export const TEMPLATE_IDS = [
  "resume_template",
  "antique_resume_template",
  "corporate_resume_template",
  "executive_resume_template",
  "minimalist_resume_template",
  "modern_resume_template",
  "multi_column_resume_template",
  "obsidian_edge_resume_template",
  "sage_multi_column_resume_template",
  "simply_blue_resume_template",
  "charcoal_glow_template",
  "orangewhite_modern_template",
  "entry_level_template",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const DEFAULT_TEMPLATE_ID: TemplateId = "modern_resume_template";

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
  columns: 1 | 2;
  /** CSS colour of the template's accent, for the picker swatch. */
  accent: string;
  /** True when a plain single-column flow that parsers read reliably. */
  atsFriendly: boolean;
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

/** One unit of AI work on a resume. Each has its own status so a failure is local. */
export const COMPONENT_KINDS = [
  "analysis",
  "rewrite",
  "interview_non_technical",
  "interview_dsa",
  "interview_programming",
  "interview_system_design",
  "roadmap",
  "projects",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const COMPONENT_STATUSES = ["pending", "processing", "done", "failed", "skipped"] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export const RESUME_STATUSES = ["queued", "processing", "analyzed", "error"] as const;
export type ResumeStatus = (typeof RESUME_STATUSES)[number];

export interface ComponentState {
  status: ComponentStatus;
  error?: string;
  updatedAt: string;
}

// ─── AI results ─────────────────────────────────────────────────────────────

export interface KeywordReport {
  matched: string[];
  /** Missing against the job description; empty when none was given. */
  missing: string[];
  notes?: string;
}

/** The analysis of one version of the resume. Scores are 0 to 100. */
export interface AnalysisReport {
  score: number;
  summary: string;
  keywords: KeywordReport;
  formatting: string;
  content: string;
  readability: { score: number; notes: string };
  strengths: string[];
  weaknesses: string[];
  repetitivePhrases: string[];
  /** Concrete edits, most valuable first. */
  improvements: string[];
}

export interface ResumeAnalysis {
  before: AnalysisReport;
  after: AnalysisReport;
}

export interface CoverLetter {
  header?: { name?: string; email?: string; phone?: string; location?: string; date?: string; recipient?: string; company?: string };
  greeting?: string;
  paragraphs: string[];
  closing?: string;
}

export interface InterviewQA {
  question: string;
  answer: string;
}

export interface InterviewGroup {
  /** e.g. "Behavioural", "Arrays and hashing", "Concurrency". */
  title: string;
  items: InterviewQA[];
}

export const INTERVIEW_TRACKS = ["non_technical", "dsa", "programming", "system_design"] as const;
export type InterviewTrack = (typeof INTERVIEW_TRACKS)[number];
export type InterviewSet = Record<InterviewTrack, InterviewGroup[]>;

export interface RoadmapPhase {
  title: string;
  /** e.g. "Weeks 1 to 4". */
  timeframe: string;
  goals: string[];
  skills: string[];
  resources: string[];
}

export interface CareerRoadmap {
  targetRole: string;
  summary: string;
  phases: RoadmapPhase[];
  certifications: string[];
}

export interface ProjectIdea {
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  tech: string[];
  outcomes: string[];
  /** A resume-ready bullet the user could add once built. */
  resumeBullet: string;
}

// ─── Resumes ────────────────────────────────────────────────────────────────

export interface ResumeSummary {
  id: string;
  title: string;
  fileName?: string;
  source: "upload" | "builder";
  status: ResumeStatus;
  /** Score of the improved resume, once analysed. */
  score?: number;
  company?: string;
  isTailored: boolean;
  parentId?: string;
  templateId: TemplateId;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeDetail extends ResumeSummary {
  jd?: string;
  components: Record<ComponentKind, ComponentState>;
  /** What was parsed from the upload (or the builder document it started from). */
  original?: ResumeDocument;
  improved?: ResumeDocument;
  analysis?: ResumeAnalysis;
  coverLetter?: CoverLetter;
  interview?: Partial<InterviewSet>;
  roadmap?: CareerRoadmap;
  projects?: ProjectIdea[];
}

export interface ResumeStatusView {
  status: ResumeStatus;
  components: Record<ComponentKind, ComponentState>;
  updatedAt: string;
}

export type DownloadKind = "original" | "resume.pdf" | "resume.docx" | "cover-letter.pdf" | "cover-letter.docx";

// ─── Builder ────────────────────────────────────────────────────────────────

export interface BuilderMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BuilderChatRequest {
  messages: BuilderMessage[];
  document?: ResumeDocument;
}

export interface BuilderChatResponse {
  assistant: string;
  document: ResumeDocument;
  nextPrompts: string[];
}

export interface ResumeDraft {
  id: string;
  name: string;
  templateId: TemplateId;
  document: ResumeDocument;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeDraftSummary {
  id: string;
  name: string;
  templateId: TemplateId;
  updatedAt: string;
}
