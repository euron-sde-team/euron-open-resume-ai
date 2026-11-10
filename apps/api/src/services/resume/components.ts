/**
 * The component registry and the resume status state machine.
 *
 * A resume is a set of components, each with its own state (resume_components). A queue job
 * runs one *job component*; "analysis" is the only one that covers two rows (analysis and
 * rewrite come out of the same AI call). The table below is the whole definition: adding a
 * component means adding a row here and an executor in pipeline.ts.
 *
 * The resume's overall status is derived from the analysis and rewrite rows alone, so an
 * on-demand interview or roadmap run never flips a finished resume back to "processing":
 *
 *   any of analysis/rewrite failed          -> error
 *   both done (or skipped)                  -> analyzed
 *   one is queued/running                   -> processing once a worker claimed it, else queued
 *   neither started                         -> queued
 */
import type { ComponentKind, ComponentState, ComponentStatus, InterviewTrack, ResumeStatus } from "@open-resume/types";
import { COMPONENT_KINDS } from "@open-resume/types";
import type { ResumeJobComponent } from "../../jobs/registry";

export interface ComponentDef {
  /** Rows this job writes. */
  covers: ComponentKind[];
  /** Runs taken when the user asks for it (the pipeline's secondary jobs are free). */
  cost: number;
  /** usage_monthly.kind the runs are charged to. */
  chargeKind: string;
  /** The interview track, for interview components. */
  track?: InterviewTrack;
}

export const COMPONENTS: Record<ResumeJobComponent, ComponentDef> = {
  analysis: { covers: ["analysis", "rewrite"], cost: 1, chargeKind: "analyze" },
  interview_non_technical: { covers: ["interview_non_technical"], cost: 1, chargeKind: "interview", track: "non_technical" },
  interview_dsa: { covers: ["interview_dsa"], cost: 1, chargeKind: "interview", track: "dsa" },
  interview_programming: { covers: ["interview_programming"], cost: 1, chargeKind: "interview", track: "programming" },
  interview_system_design: { covers: ["interview_system_design"], cost: 1, chargeKind: "interview", track: "system_design" },
  roadmap: { covers: ["roadmap"], cost: 1, chargeKind: "roadmap" },
  projects: { covers: ["projects"], cost: 1, chargeKind: "projects" },
};

/** Components a user may generate on demand (POST /api/resumes/:id/components/:kind). */
export const ON_DEMAND_KINDS = ["interview_non_technical", "interview_dsa", "interview_programming", "interview_system_design", "roadmap", "projects"] as const;
export type OnDemandKind = (typeof ON_DEMAND_KINDS)[number];

/** What an upload runs by default: the analysis job, then the non-technical interview set. */
export const DEFAULT_PIPELINE: ResumeJobComponent[] = ["analysis", "interview_non_technical"];

/** The job that owns a component row ("rewrite" belongs to the analysis job). */
export function jobFor(kind: ComponentKind): ResumeJobComponent {
  return kind === "rewrite" ? "analysis" : kind;
}

export const MAX_ATTEMPTS = 3;
/** A claim older than this is a crashed worker; another may take the job. */
export const STALE_CLAIM_MS = 10 * 60_000;
/** A component "processing" for longer than this lost its job; it is failed and refunded. */
export const STALE_REQUEST_MS = 30 * 60_000;

export interface ComponentRow {
  kind: ComponentKind;
  status: ComponentStatus;
  claimed: boolean;
}

export function deriveStatus(rows: ComponentRow[]): ResumeStatus {
  const get = (k: ComponentKind) => rows.find((r) => r.kind === k);
  const core = [get("analysis"), get("rewrite")];
  if (core.some((r) => r?.status === "failed")) return "error";
  if (core.every((r) => r && (r.status === "done" || r.status === "skipped"))) return "analyzed";
  if (core.some((r) => r?.status === "processing" && r.claimed)) return "processing";
  return "queued";
}

export interface ComponentRecord {
  kind: ComponentKind;
  status: ComponentStatus;
  error: string | null;
  updated_at: Date;
}

/** Every kind, in contract order; kinds without a row are "pending" (not generated yet). */
export function componentStates(rows: ComponentRecord[], fallbackAt: Date): Record<ComponentKind, ComponentState> {
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const out = {} as Record<ComponentKind, ComponentState>;
  for (const kind of COMPONENT_KINDS) {
    const r = byKind.get(kind);
    out[kind] = r
      ? { status: r.status, ...(r.error ? { error: r.error } : {}), updatedAt: r.updated_at.toISOString() }
      : { status: "pending", updatedAt: fallbackAt.toISOString() };
  }
  return out;
}
