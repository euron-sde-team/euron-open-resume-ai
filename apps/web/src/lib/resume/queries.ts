"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Page, ResumeSummary } from "@open-resume/types";
import { toast } from "@open-resume/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";

export function useResumeList() {
  return useInfiniteQuery({
    queryKey: qk.resumes,
    queryFn: ({ pageParam }) => api().resumes.list({ cursor: pageParam || undefined, limit: 30 }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
    staleTime: 10_000,
  });
}

export function useResume(id: string) {
  return useQuery({ queryKey: qk.resume(id), queryFn: ({ signal }) => api().resumes.get(id, signal), staleTime: 5_000 });
}

export function useTemplates() {
  return useQuery({ queryKey: qk.templates, queryFn: ({ signal }) => api().templates.list(signal), staleTime: 10 * 60_000 });
}

/** Deletes a resume and drops it from the cached list at once. */
export function useDeleteResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api().resumes.remove(id),
    onSuccess: (_d, id) => {
      qc.setQueryData<{ pages: Page<ResumeSummary>[]; pageParams: unknown[] }>(qk.resumes, (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((r) => r.id !== id) })) } : old,
      );
      qc.removeQueries({ queryKey: qk.resume(id) });
      void qc.invalidateQueries({ queryKey: qk.usage });
      toast.success({ title: "Resume deleted" });
    },
  });
}

export function flattenResumes(data: { pages: Page<ResumeSummary>[] } | undefined): ResumeSummary[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}
