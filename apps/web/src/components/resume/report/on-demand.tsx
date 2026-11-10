"use client";

import type { ReactNode } from "react";
import type { ComponentKind, ResumeDetail } from "@open-resume/types";
import { Button } from "@open-resume/ui";
import { COMPONENT_LABEL } from "@/lib/resume/format";
import { QuotaNotice, useQuota } from "../quota-notice";

export interface Actions {
  generate: (kind: Extract<ComponentKind, "interview_non_technical" | "interview_dsa" | "interview_programming" | "interview_system_design" | "roadmap" | "projects">) => void;
  retry: (kind?: ComponentKind) => void;
  busy: boolean;
}

/**
 * Shows an on-demand part when it exists; otherwise the one thing to do: wait, try again
 * or generate it (each generation costs one run, said before the click).
 */
export function OnDemand({
  kind,
  detail,
  actions,
  hasData,
  noun,
  children,
}: {
  kind: Parameters<Actions["generate"]>[0];
  detail: ResumeDetail;
  actions: Actions;
  hasData: boolean;
  noun: string;
  children: ReactNode;
}) {
  const { quota } = useQuota();
  const state = detail.components?.[kind];
  const resumeWorking = detail.status === "queued" || detail.status === "processing";
  if (hasData && state?.status !== "processing") return <>{children}</>;
  if (state?.status === "processing" || (state?.status === "pending" && resumeWorking)) {
    return (
      <p role="status" data-testid={`${kind}-working`} className="text-[14px] text-muted-foreground">
        {state?.status === "processing" ? `Writing ${noun}. This takes a moment.` : `${COMPONENT_LABEL[kind]}: waiting for the analysis to finish.`}
      </p>
    );
  }
  if (state?.status === "failed") {
    return (
      <div role="alert">
        <p className="text-[14px] font-medium text-danger">Could not write {noun}.{state.error ? ` ${state.error}` : ""}</p>
        <Button className="mt-3" variant="outline" size="sm" loading={actions.busy} disabled={quota.exhausted} onClick={() => actions.retry(kind)} data-testid={`${kind}-retry`}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div>
      <p className="max-w-[60ch] text-[14.5px] text-muted-foreground">Write {noun} from this resume{detail.jd ? " and its job description" : ""}.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={quota.exhausted} loading={actions.busy} onClick={() => actions.generate(kind)} data-testid={`${kind}-generate`}>
          Generate
        </Button>
        <QuotaNotice quota={quota} cost />
      </div>
    </div>
  );
}
