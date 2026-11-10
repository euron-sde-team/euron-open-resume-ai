"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComponentKind, ResumeDetail, ResumeStatusView } from "@open-resume/types";
import { Button, Skeleton } from "@open-resume/ui";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { COMPONENT_LABEL, metaLine, resumeFacts } from "@/lib/resume/format";
import { useResumeStatus } from "@/lib/resume/polling";
import { useResume } from "@/lib/resume/queries";
import { relativeTime } from "@/lib/time";
import { PageFrame } from "../page-frame";
import { QuotaNotice, useQuota } from "../quota-notice";
import { AnalysisTab } from "./analysis-tab";
import { CoverLetterTab } from "./cover-letter-tab";
import { ImprovedTab } from "./improved-tab";
import { InterviewTab, ProjectsTab, RoadmapTab } from "./extras-tabs";
import type { Actions } from "./on-demand";
import { TailorTab } from "./tailor-tab";

const TABS = [
  { value: "analysis", label: "Analysis" },
  { value: "improved", label: "Improved resume" },
  { value: "cover-letter", label: "Cover letter" },
  { value: "interview", label: "Interview" },
  { value: "roadmap", label: "Roadmap" },
  { value: "projects", label: "Projects" },
  { value: "tailor", label: "Tailor" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

const isTab = (v: string | null): v is TabValue => !!v && TABS.some((t) => t.value === v);

/** One muted line per pipeline step while the resume is being worked on. */
function Progress({ view }: { view: ResumeStatusView | undefined }) {
  const steps = (["analysis", "rewrite"] as const).map((k) => ({ k, s: view?.components?.[k]?.status ?? "pending" }));
  const word = (s: string) => (s === "done" ? "Done" : s === "processing" ? "Working" : s === "failed" ? "Failed" : s === "skipped" ? "Skipped" : "Waiting");
  return (
    <div role="status" aria-live="polite" data-testid="report-progress" className="mb-8">
      <p className="text-[14.5px] font-medium">Working on your resume. You can leave this page; it keeps going.</p>
      <ul className="mt-2 space-y-0.5">
        {steps.map(({ k, s }) => (
          <li key={k} className="text-[13.5px] text-muted-foreground">
            {COMPONENT_LABEL[k]} · {word(s)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading resume" className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-8 h-40 w-full" />
    </div>
  );
}

export function ResumeReport({ id }: { id: string }) {
  const params = useSearchParams();
  const qc = useQueryClient();
  const q = useResume(id);
  const status = useResumeStatus(id, { enabled: q.isSuccess });
  const { quota } = useQuota();
  const tab: TabValue = isTab(params.get("tab")) ? (params.get("tab") as TabValue) : "analysis";

  const afterAction = (kind?: ComponentKind) => {
    status.kick(kind);
    void qc.invalidateQueries({ queryKey: qk.usage });
    void qc.invalidateQueries({ queryKey: qk.resume(id) });
  };
  const retry = useMutation({ mutationFn: (kind?: ComponentKind) => api().resumes.retry(id, kind), onSuccess: (_d, kind) => afterAction(kind) });
  const generate = useMutation({ mutationFn: (kind: Parameters<Actions["generate"]>[0]) => api().resumes.generate(id, kind), onSuccess: (_d, kind) => afterAction(kind) });
  const actions: Actions = {
    generate: (k) => generate.mutate(k),
    retry: (k) => retry.mutate(k),
    busy: generate.isPending || retry.isPending,
  };

  if (q.isPending) {
    return (
      <PageFrame>
        <ReportSkeleton />
      </PageFrame>
    );
  }
  if (q.isError) {
    return (
      <PageFrame>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </PageFrame>
    );
  }

  // The status poll is fresher than the report between refetches.
  const live: ResumeDetail = status.data ? { ...q.data, status: status.data.status, components: status.data.components } : q.data;
  const d = live;
  const working = d.status === "queued" || d.status === "processing";
  const failedCore = d.components?.analysis?.status === "failed" || d.status === "error";
  const before = d.analysis?.before.score;
  const after = d.analysis?.after.score ?? d.score;

  return (
    <PageFrame width="max-w-[860px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="mb-1 text-[13px]">
            <Link href="/resumes" className="text-muted-foreground hover:text-foreground">
              Resumes
            </Link>
          </p>
          <h1 data-testid="report-title" className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">
            {d.title || "Untitled resume"}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{metaLine([...resumeFacts(d), `Updated ${relativeTime(d.updatedAt)}`])}</p>
        </div>
        {typeof after === "number" ? (
          <p data-testid="report-score" aria-label={typeof before === "number" ? `Score ${Math.round(before)} before, ${Math.round(after)} after` : `Score ${Math.round(after)}`} className="font-display text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
            {typeof before === "number" ? <span className="mr-2 text-[24px] font-normal text-subtle-foreground">{Math.round(before)} &rarr;</span> : null}
            {Math.round(after)}
          </p>
        ) : null}
      </header>

      <QuotaNotice quota={quota} className="mb-6" />

      {working ? <Progress view={status.data} /> : null}
      {failedCore && !working ? (
        <div role="alert" data-testid="report-error" className="mb-8">
          <p className="text-[14.5px] font-medium text-danger">The analysis did not finish.{d.components?.analysis?.error ? ` ${d.components.analysis.error}` : ""}</p>
          <Button className="mt-3" variant="outline" size="sm" loading={retry.isPending} disabled={quota.exhausted} onClick={() => retry.mutate(undefined)} data-testid="report-retry">
            Try again
          </Button>
        </div>
      ) : null}

      <UnderlineTabs label="Resume sections" idPrefix="report" className="mb-8" value={tab} tabs={TABS.map((t) => ({ ...t, href: `/resumes/${id}?tab=${t.value}` }))} />
      <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${tab}`} tabIndex={0} className="focus-visible:outline-none">
        {tab === "analysis" ? <AnalysisTab detail={d} /> : null}
        {tab === "improved" ? <ImprovedTab detail={d} actions={actions} /> : null}
        {tab === "cover-letter" ? <CoverLetterTab detail={d} /> : null}
        {tab === "interview" ? <InterviewTab detail={d} actions={actions} /> : null}
        {tab === "roadmap" ? <RoadmapTab detail={d} actions={actions} /> : null}
        {tab === "projects" ? <ProjectsTab detail={d} actions={actions} /> : null}
        {tab === "tailor" ? <TailorTab detail={d} /> : null}
      </div>
    </PageFrame>
  );
}
