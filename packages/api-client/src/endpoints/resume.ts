/**
 * Resume AI: resumes and their pipeline, templates, the chat builder and drafts.
 * One helper per route of the contract (docs: the Resume AI API contract). Everything is
 * scoped to the signed-in user by the API; someone else's id is a plain 404.
 */
import type {
  BuilderChatRequest,
  BuilderChatResponse,
  ComponentKind,
  DownloadKind,
  Page,
  ResumeDetail,
  ResumeDocument,
  ResumeDraft,
  ResumeDraftSummary,
  ResumeStatusView,
  ResumeSummary,
  TemplateId,
  TemplateInfo,
} from "@open-resume/types";
import { postForm, type UploadOptions } from "../upload";
import { enc, type Helpers, type PageQuery } from "./helpers";

/** The components a person can ask for on demand; each costs one run. */
export const ON_DEMAND_KINDS = ["interview_non_technical", "interview_dsa", "interview_programming", "interview_system_design", "roadmap", "projects"] as const;
export type OnDemandKind = (typeof ON_DEMAND_KINDS)[number];

export interface UploadResumeInput {
  file: File | Blob;
  /** Needed when `file` is a Blob without a name. */
  fileName?: string;
  jd?: string;
  company?: string;
  templateId?: TemplateId;
}

export interface FromDocumentInput {
  document: ResumeDocument;
  templateId?: TemplateId;
  jd?: string;
  company?: string;
  title?: string;
}

export interface TailorInput {
  jd: string;
  company?: string;
}

export interface DraftInput {
  name?: string;
  templateId?: TemplateId;
  document: ResumeDocument;
}

export interface ImportResult {
  assistant: string;
  document: ResumeDocument;
}

/** The multipart body of POST /resumes: text fields are left out when blank. */
export function buildUploadForm(input: UploadResumeInput): FormData {
  const form = new FormData();
  const name = input.fileName ?? (input.file as File).name ?? "resume";
  form.append("file", input.file, name);
  const jd = input.jd?.trim();
  const company = input.company?.trim();
  if (jd) form.append("jd", jd);
  if (company) form.append("company", company);
  if (input.templateId) form.append("templateId", input.templateId);
  return form;
}

export function resumeEndpoints(h: Helpers) {
  const { http, get, post, put, del, download } = h;

  const resumes = {
    list: (q?: PageQuery) => get<Page<ResumeSummary>>("/resumes", h.pq(q)),
    get: (id: string, signal?: AbortSignal) => get<ResumeDetail>(`/resumes/${enc(id)}`, undefined, signal),
    /** Cheap, for polling. */
    status: (id: string, signal?: AbortSignal) => get<ResumeStatusView>(`/resumes/${enc(id)}/status`, undefined, signal),
    /** Multipart upload with progress; 202 with the new resume. */
    upload: (input: UploadResumeInput, opts?: UploadOptions) => postForm<ResumeSummary>(http, "/resumes", buildUploadForm(input), opts),
    /** The builder's "analyse this resume". */
    fromDocument: (body: FromDocumentInput) => post<ResumeSummary>("/resumes/from-document", body),
    /** Re-runs failed components, or one component, or the whole pipeline when `component` is omitted. */
    retry: (id: string, component?: ComponentKind) => post<void>(`/resumes/${enc(id)}/retry`, component ? { component } : {}),
    /** Creates a NEW resume tailored to a job description. */
    tailor: (id: string, body: TailorInput) => post<ResumeSummary>(`/resumes/${enc(id)}/tailor`, body),
    /** Generates one on-demand component. */
    generate: (id: string, kind: OnDemandKind) => post<void>(`/resumes/${enc(id)}/components/${enc(kind)}`),
    remove: (id: string) => del(`/resumes/${enc(id)}`),
    /** A file; `template` re-renders resume.pdf with another template. */
    download: (id: string, what: DownloadKind, template?: TemplateId) => download(`/resumes/${enc(id)}/download/${enc(what)}`, template ? { template } : undefined),
    /** The improved resume as an HTML page, for a sandboxed iframe. */
    render: (id: string, template: TemplateId, signal?: AbortSignal) => get<string>(`/resumes/${enc(id)}/render`, { template }, signal),
  };

  const templates = {
    list: (signal?: AbortSignal) => get<TemplateInfo[]>("/templates", undefined, signal),
  };

  const builder = {
    /** HTML for the live preview: no AI, no quota. */
    render: (document: ResumeDocument, templateId: TemplateId, signal?: AbortSignal) =>
      http.request<string>("POST", "/builder/render", { body: { document, templateId }, signal }),
    export: async (document: ResumeDocument, templateId: TemplateId, format: "pdf" | "docx"): Promise<Blob> =>
      (await http.request<Response>("POST", "/builder/export", { body: { document, templateId, format }, raw: true })).blob(),
    /** One conversational turn; costs one run. */
    chat: (body: BuilderChatRequest, signal?: AbortSignal) => http.request<BuilderChatResponse>("POST", "/builder/chat", { body, signal }),
    /** Reads a file into the document; costs one run. */
    import: (file: File, opts?: UploadOptions) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return postForm<ImportResult>(http, "/builder/import", form, opts);
    },
  };

  const drafts = {
    /** The API may answer with a bare list or a page; both are accepted. */
    list: async (): Promise<ResumeDraftSummary[]> => {
      const r = await get<ResumeDraftSummary[] | Page<ResumeDraftSummary>>("/drafts");
      return Array.isArray(r) ? r : (r?.items ?? []);
    },
    get: (id: string) => get<ResumeDraft>(`/drafts/${enc(id)}`),
    create: (body: DraftInput) => post<ResumeDraft>("/drafts", body),
    update: (id: string, body: DraftInput) => put<ResumeDraft>(`/drafts/${enc(id)}`, body),
    remove: (id: string) => del(`/drafts/${enc(id)}`),
  };

  return { resumes, templates, builder, drafts };
}
