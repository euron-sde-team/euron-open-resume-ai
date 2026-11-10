"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResumeDraftSummary } from "@open-resume/types";
import { IconButton, Sheet, SheetContent, Skeleton, toast } from "@open-resume/ui";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";

export function DraftsDrawer({ open, onOpenChange, currentId, onOpen, onDeleted }: { open: boolean; onOpenChange: (o: boolean) => void; currentId: string | null; onOpen: (d: ResumeDraftSummary) => void; onDeleted: (id: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: qk.drafts, queryFn: () => api().drafts.list(), enabled: open, staleTime: 0 });
  const [deleting, setDeleting] = useState<ResumeDraftSummary | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api().drafts.remove(id),
    onSuccess: (_d, id) => {
      qc.setQueryData<ResumeDraftSummary[]>(qk.drafts, (old) => old?.filter((d) => d.id !== id));
      onDeleted(id);
      toast.success({ title: "Draft deleted" });
    },
  });
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent aria-label="Your drafts" aria-describedby={undefined} data-testid="drafts-drawer">
          <div className="shrink-0 px-5 pb-3 pt-4 pr-12">
            <h2 className="font-display text-[20px] font-semibold">Your drafts</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Saved resumes you are still working on.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {list.isPending ? (
              <div className="space-y-4" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : list.isError ? (
              <ErrorState error={list.error} compact onRetry={() => void list.refetch()} />
            ) : list.data.length === 0 ? (
              <p className="py-6 text-[14px] text-muted-foreground">No drafts yet. Save your resume to keep it here.</p>
            ) : (
              <ul className="border-t border-border">
                {list.data.map((d) => (
                  <li key={d.id} className="group flex items-center gap-1 border-b border-border" data-testid="draft-row">
                    <button type="button" onClick={() => onOpen(d)} aria-current={d.id === currentId ? "true" : undefined} className="min-w-0 flex-1 py-3 text-left focus-visible:rounded-sm">
                      <span className="block truncate text-[14.5px] font-medium">{d.name || "Untitled draft"}</span>
                      <span className="block text-[12.5px] text-muted-foreground">
                        {d.id === currentId ? "Open now · " : ""}Updated {relativeTime(d.updatedAt)}
                      </span>
                    </button>
                    <IconButton label={`Delete draft ${d.name || "Untitled draft"}`} size="sm" className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => setDeleting(d)}>
                      <Trash2 />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={deleting ? `Delete draft "${deleting.name || "Untitled draft"}"?` : "Delete draft?"}
        description="The draft is removed for good. Resumes you analysed from it are not affected."
        confirmLabel="Delete draft"
        onConfirm={() => (deleting ? del.mutateAsync(deleting.id) : undefined)}
      />
    </>
  );
}
