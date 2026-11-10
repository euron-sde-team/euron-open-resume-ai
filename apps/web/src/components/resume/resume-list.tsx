"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText, MessageSquarePlus, Trash2, Upload } from "lucide-react";
import type { ResumeSummary } from "@open-resume/types";
import { Button, EmptyState, IconButton, Skeleton } from "@open-resume/ui";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { relativeTime } from "@/lib/time";
import { metaLine, resumeFacts, scoreText, STATUS_WORD } from "@/lib/resume/format";
import { flattenResumes, useDeleteResume, useResumeList } from "@/lib/resume/queries";
import { PageFrame, PageHeading } from "./page-frame";
import { QuotaNotice, useQuota } from "./quota-notice";

function Row({ r, onDelete }: { r: ResumeSummary; onDelete: (r: ResumeSummary) => void }) {
  const working = r.status === "queued" || r.status === "processing";
  return (
    <li data-testid="resume-row" className="group flex items-center gap-2 border-b border-border">
      <Link href={`/resumes/${r.id}`} className="flex min-w-0 flex-1 items-center gap-4 py-4 focus-visible:rounded-sm">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-medium">{r.title || "Untitled resume"}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{metaLine([...resumeFacts(r), `Updated ${relativeTime(r.updatedAt)}`])}</span>
        </span>
        <span className="shrink-0 text-right">
          <span data-testid="resume-score" className="block font-display text-[20px] font-semibold tabular-nums leading-none">
            {scoreText(r.score) || <span className="text-subtle-foreground">&ndash;</span>}
          </span>
          <span data-testid="resume-status" className={working ? "mt-1 block text-[12.5px] text-primary" : r.status === "error" ? "mt-1 block text-[12.5px] text-danger" : "mt-1 block text-[12.5px] text-muted-foreground"}>
            {STATUS_WORD[r.status]}
          </span>
        </span>
      </Link>
      <IconButton label={`Delete ${r.title || "resume"}`} size="sm" className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => onDelete(r)} data-testid="resume-delete">
        <Trash2 />
      </IconButton>
    </li>
  );
}

function Entries() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="primary" data-testid="entry-upload">
        <Link href="/resumes/new">
          <Upload /> Upload a resume
        </Link>
      </Button>
      <Button asChild variant="outline" data-testid="entry-builder">
        <Link href="/builder">
          <MessageSquarePlus /> Build with chat
        </Link>
      </Button>
    </div>
  );
}

export function ResumesView() {
  const list = useResumeList();
  const del = useDeleteResume();
  const { quota } = useQuota();
  const [deleting, setDeleting] = useState<ResumeSummary | null>(null);
  const items = flattenResumes(list.data);

  return (
    <PageFrame>
      <PageHeading title="Resumes" testId="resumes-title" meta={<QuotaNotice quota={quota} className="inline" />} actions={items.length ? <Entries /> : undefined} />
      {list.isPending ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading resumes">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between border-b border-border py-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState className="mt-6" icon={<FileText />} title="No resumes yet" description="Upload the one you have to get a score, an improved version and interview prep, or build a new one by chatting." action={<Entries />} />
      ) : (
        <>
          <ul aria-label="Your resumes" className="border-t border-border">
            {items.map((r) => (
              <Row key={r.id} r={r} onDelete={setDeleting} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={deleting ? `Delete "${deleting.title || "Untitled resume"}"?` : "Delete resume?"}
        description="The resume, its analysis and the files stored for it are removed. This cannot be undone."
        confirmLabel="Delete resume"
        onConfirm={() => (deleting ? del.mutateAsync(deleting.id) : undefined)}
      />
    </PageFrame>
  );
}
