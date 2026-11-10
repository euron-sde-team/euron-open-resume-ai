/** Database rows to the contract types in packages/types/src/resume.ts. */
import type {
  CareerRoadmap,
  CoverLetter,
  InterviewGroup,
  InterviewSet,
  ProjectIdea,
  ResumeAnalysis,
  ResumeDetail,
  ResumeDocument,
  ResumeDraft,
  ResumeDraftSummary,
  ResumeStatusView,
  ResumeSummary,
  TemplateId,
} from "@open-resume/types";
import { TEMPLATE_IDS, DEFAULT_TEMPLATE_ID } from "@open-resume/types";
import type { ComponentDbRow } from "../repositories/resume-component.repository";
import type { DraftRow } from "../repositories/resume-draft.repository";
import type { ResumeRow, ResumeSummaryRow } from "../repositories/resume.repository";
import { componentStates } from "../services/resume/components";

export function asTemplateId(id: string | null | undefined): TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id ?? "") ? (id as TemplateId) : DEFAULT_TEMPLATE_ID;
}

export function toSummary(r: ResumeSummaryRow | ResumeRow): ResumeSummary {
  return {
    id: r.id,
    title: r.title,
    ...(r.file_name ? { fileName: r.file_name } : {}),
    source: r.source,
    status: r.status,
    ...(r.score !== null ? { score: r.score } : {}),
    ...(r.company ? { company: r.company } : {}),
    isTailored: r.is_tailored,
    ...(r.parent_id ? { parentId: r.parent_id } : {}),
    templateId: asTemplateId(r.template_id),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export function toStatusView(r: Pick<ResumeRow, "status" | "created_at" | "updated_at">, comps: ComponentDbRow[]): ResumeStatusView {
  const newest = comps.reduce((a, c) => (c.updated_at > a ? c.updated_at : a), r.updated_at);
  return { status: r.status, components: componentStates(comps, r.created_at), updatedAt: newest.toISOString() };
}

export function toDetail(r: ResumeRow, comps: ComponentDbRow[]): ResumeDetail {
  const data = (kind: ComponentDbRow["kind"]) => comps.find((c) => c.kind === kind && c.status === "done")?.data ?? undefined;
  const interview: Partial<InterviewSet> = {};
  const tracks = [
    ["non_technical", "interview_non_technical"],
    ["dsa", "interview_dsa"],
    ["programming", "interview_programming"],
    ["system_design", "interview_system_design"],
  ] as const;
  for (const [track, kind] of tracks) {
    const d = data(kind);
    if (Array.isArray(d)) interview[track] = d as unknown as InterviewGroup[];
  }
  return {
    ...toSummary(r),
    ...(r.jd ? { jd: r.jd } : {}),
    components: componentStates(comps, r.created_at),
    ...(r.original ? { original: r.original as ResumeDocument } : {}),
    ...(r.improved ? { improved: r.improved as ResumeDocument } : {}),
    ...(r.analysis ? { analysis: r.analysis as unknown as ResumeAnalysis } : {}),
    ...(r.cover_letter ? { coverLetter: r.cover_letter as unknown as CoverLetter } : {}),
    ...(Object.keys(interview).length ? { interview } : {}),
    ...(data("roadmap") ? { roadmap: data("roadmap") as unknown as CareerRoadmap } : {}),
    ...(Array.isArray(data("projects")) ? { projects: data("projects") as unknown as ProjectIdea[] } : {}),
  };
}


export function toDraft(r: DraftRow): ResumeDraft {
  return {
    id: r.id,
    name: r.name,
    templateId: asTemplateId(r.template_id),
    document: r.document as ResumeDocument,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export function toDraftSummary(r: Pick<DraftRow, "id" | "name" | "template_id" | "updated_at">): ResumeDraftSummary {
  return { id: r.id, name: r.name, templateId: asTemplateId(r.template_id), updatedAt: r.updated_at.toISOString() };
}
