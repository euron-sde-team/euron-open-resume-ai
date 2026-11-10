"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComponentKind, ResumeStatusView } from "@open-resume/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";

const BASE_MS = 1500;
const MAX_MS = 10_000;

/** Backoff between polls: 1.5 s growing by 1.5x to a ceiling of 10 s. */
export function nextPollDelay(attempt: number): number {
  return Math.min(MAX_MS, Math.round(BASE_MS * Math.pow(1.5, Math.max(0, attempt))));
}

/** Work is in flight while the resume is queued or processing, or any component is. */
export function isWorking(view: Pick<ResumeStatusView, "status" | "components"> | undefined): boolean {
  if (!view) return true;
  if (view.status === "queued" || view.status === "processing") return true;
  return Object.values(view.components ?? {}).some((c) => c?.status === "processing");
}

/** A compact signature of component statuses, to notice a change worth refetching the report for. */
export function componentSignature(view: Pick<ResumeStatusView, "components"> | undefined): string {
  if (!view) return "";
  return Object.entries(view.components ?? {})
    .map(([k, c]) => `${k}:${c?.status}`)
    .sort()
    .join("|");
}

/**
 * Polls GET /resumes/:id/status with backoff until the resume is analysed (or errored) and
 * no component is running. `kick()` restarts polling after the person asks for more work
 * (retry, generate). When any component changes status the report itself is refetched.
 */
export function useResumeStatus(id: string, opts: { enabled?: boolean } = {}) {
  const qc = useQueryClient();
  const attempt = useRef(0);
  const query = useQuery({
    queryKey: qk.resumeStatus(id),
    queryFn: ({ signal }) => api().resumes.status(id, signal),
    enabled: opts.enabled ?? true,
    staleTime: 0,
    meta: { silent: true },
    // A person who switches tabs while the analysis runs finds it finished on return.
    refetchIntervalInBackground: true,
    refetchInterval: (q) => {
      if (!isWorking(q.state.data)) return false;
      const d = nextPollDelay(attempt.current);
      attempt.current += 1;
      return d;
    },
  });

  const sig = componentSignature(query.data);
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (!sig) return;
    if (lastSig.current !== null && lastSig.current !== sig) void qc.invalidateQueries({ queryKey: qk.resume(id) });
    lastSig.current = sig;
  }, [sig, id, qc]);

  const working = isWorking(query.data);
  useEffect(() => {
    if (working) return;
    // Settled: make sure the report holds the final data once.
    void qc.invalidateQueries({ queryKey: qk.resume(id) });
  }, [working, id, qc]);

  const kick = (kind?: ComponentKind) => {
    attempt.current = 0;
    if (kind) {
      qc.setQueryData<ResumeStatusView>(qk.resumeStatus(id), (old) =>
        old ? { ...old, components: { ...old.components, [kind]: { ...old.components[kind], status: "processing", error: undefined } } } : old,
      );
    }
    void qc.invalidateQueries({ queryKey: qk.resumeStatus(id) });
  };

  return { ...query, working, kick };
}
