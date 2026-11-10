"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TierInput } from "@open-resume/api-client";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Field, IconButton, Input, Switch, toast } from "@open-resume/ui";
import { MoreHorizontal } from "lucide-react";
import type { QuotaTier } from "@open-resume/types";
import { api } from "@/lib/api";
import { adminErrorMessage, formatCount, limitLabel, limitText, parseLimit } from "@/lib/admin";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AdminPage, DataTable, Dot, type Column } from "../shell";
import { adminMutation, ak } from "./common";

export function AdminQuotas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ak.tiers, queryFn: () => api().admin.tiers() });
  const [editing, setEditing] = useState<QuotaTier | "new" | null>(null);
  const [deleting, setDeleting] = useState<QuotaTier | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api().admin.deleteTier(id),
    ...adminMutation(),
    onSuccess: (list) => {
      qc.setQueryData(ak.tiers, list);
      void qc.invalidateQueries({ queryKey: ak.usersPrefix });
      toast.success({ title: "Tier deleted" });
    },
  });
  const columns = useMemo<Column<QuotaTier>[]>(
    () => [
      {
        key: "name",
        header: "Tier",
        cell: (t) => (
          <span className="inline-flex items-center gap-2">
            <span className="font-medium text-foreground">{t.name}</span>
            {t.isDefault ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Dot tone="primary" /> Default
              </span>
            ) : null}
          </span>
        ),
        sortValue: (t) => t.name,
      },
      { key: "runs", header: "AI runs a month", align: "right", cell: (t) => limitLabel(t.monthlyRuns), sortValue: (t) => t.monthlyRuns ?? Number.MAX_SAFE_INTEGER },
      { key: "resumes", header: "Resumes", align: "right", cell: (t) => limitLabel(t.maxResumes), sortValue: (t) => t.maxResumes ?? Number.MAX_SAFE_INTEGER, hideBelow: "sm" },
      { key: "upload", header: "Max upload", align: "right", cell: (t) => (t.maxUploadMb === null ? "Unlimited" : `${t.maxUploadMb} MB`), sortValue: (t) => t.maxUploadMb ?? Number.MAX_SAFE_INTEGER, hideBelow: "md" },
      { key: "users", header: "Users", align: "right", cell: (t) => formatCount(t.userCount), sortValue: (t) => t.userCount, hideBelow: "sm" },
      {
        key: "menu",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        className: "w-10",
        cell: (t) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${t.name}`} size="sm" data-testid={`tier-menu-${t.name}`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(t)}>Edit</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDeleting(t)} disabled={t.isDefault} className="text-danger">
                {t.isDefault ? "Default tier cannot be deleted" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );
  return (
    <AdminPage
      title="Quotas"
      description="Monthly AI runs, saved resumes and upload size per tier. Runs are counted per calendar month in UTC. Every account is on the default tier unless you move it."
      actions={
        <Button onClick={() => setEditing("new")} data-testid="tier-add">
          Add tier
        </Button>
      }
      testId="admin-quotas"
    >
      <DataTable
        caption="Quota tiers"
        rows={q.data ?? []}
        columns={columns}
        rowKey={(t) => t.id}
        onRowClick={(t) => setEditing(t)}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeletonRows={3}
        empty={{ title: "No tiers yet." }}
        rowTestId={(t) => `tier-row-${t.name}`}
        testId="tiers-table"
      />
      <p className="mt-4 text-[13px] text-muted-foreground">To give one account its own limits, open it on the Users page.</p>
      <TierDialog value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the ${deleting?.name ?? ""} tier?`}
        description={deleting?.userCount ? `Its ${formatCount(deleting.userCount)} ${deleting.userCount === 1 ? "account moves" : "accounts move"} to the default tier.` : "No accounts use it."}
        confirmLabel="Delete tier"
        destructive
        onConfirm={() => del.mutateAsync(deleting!.id)}
      />
    </AdminPage>
  );
}

type TierDraft = { name: string; runs: string; resumes: string; uploadMb: string; isDefault: boolean };
const NEW_TIER: TierDraft = { name: "", runs: "20", resumes: "10", uploadMb: "10", isDefault: false };

/** Field errors for a tier draft, matching the API's limits. */
export function tierDraftErrors(d: Pick<TierDraft, "name" | "runs" | "resumes" | "uploadMb">): Partial<Record<"name" | "runs" | "resumes" | "uploadMb", string>> {
  const e: Partial<Record<"name" | "runs" | "resumes" | "uploadMb", string>> = {};
  if (!d.name.trim()) e.name = "Give the tier a name.";
  else if (d.name.trim().length > 60) e.name = "Use 60 characters or fewer.";
  if (parseLimit(d.runs) === undefined) e.runs = "Use a whole number, or leave it empty for unlimited.";
  if (parseLimit(d.resumes) === undefined) e.resumes = "Use a whole number, or leave it empty for unlimited.";
  const mb = parseLimit(d.uploadMb);
  if (mb === undefined || (mb !== null && (mb < 1 || mb > 500))) e.uploadMb = "Between 1 and 500 MB, or empty for unlimited.";
  return e;
}

function TierDialog({ value, onClose }: { value: QuotaTier | "new" | null; onClose: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const existing = value && value !== "new" ? value : null;
  const [d, setD] = useState<TierDraft>(NEW_TIER);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setError(null);
    setD(existing ? { name: existing.name, runs: limitText(existing.monthlyRuns), resumes: limitText(existing.maxResumes), uploadMb: limitText(existing.maxUploadMb), isDefault: existing.isDefault } : NEW_TIER);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const errs = tierDraftErrors(d);
  const ok = Object.keys(errs).length === 0;
  const save = useMutation({
    mutationFn: () => {
      const body: TierInput = { name: d.name.trim(), monthlyRuns: parseLimit(d.runs) ?? null, maxResumes: parseLimit(d.resumes) ?? null, maxUploadMb: parseLimit(d.uploadMb) ?? null, isDefault: d.isDefault };
      return existing ? api().admin.updateTier(existing.id, body) : api().admin.createTier(body);
    },
    ...adminMutation({ inline: true }),
    onError: (e) => setError(adminErrorMessage(e)),
    onSuccess: (list) => {
      qc.setQueryData(ak.tiers, list);
      void qc.invalidateQueries({ queryKey: ak.usersPrefix });
      toast.success({ title: existing ? "Tier saved" : "Tier added" });
      onClose();
    },
  });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="md" data-testid="tier-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.name}` : "Add a tier"}</DialogTitle>
            <DialogDescription>Leave a limit empty for unlimited.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor={`${id}-name`} error={d.name ? errs.name : undefined}>
              <Input id={`${id}-name`} value={d.name} maxLength={60} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} data-testid="tier-name" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="AI runs a month" htmlFor={`${id}-r`} error={errs.runs}>
                <Input id={`${id}-r`} inputMode="numeric" placeholder="Unlimited" value={d.runs} onChange={(e) => setD((x) => ({ ...x, runs: e.target.value }))} data-testid="tier-runs" />
              </Field>
              <Field label="Saved resumes" htmlFor={`${id}-s`} error={errs.resumes}>
                <Input id={`${id}-s`} inputMode="numeric" placeholder="Unlimited" value={d.resumes} onChange={(e) => setD((x) => ({ ...x, resumes: e.target.value }))} data-testid="tier-resumes" />
              </Field>
              <Field label="Largest upload, MB" htmlFor={`${id}-mb`} error={errs.uploadMb}>
                <Input id={`${id}-mb`} inputMode="numeric" placeholder="Unlimited" value={d.uploadMb} onChange={(e) => setD((x) => ({ ...x, uploadMb: e.target.value }))} data-testid="tier-upload-mb" />
              </Field>
            </div>
            <label className="flex items-center justify-between gap-4 border-t border-border pt-4 text-[14px]">
              <span>
                <span className="font-medium">Default tier</span>
                <span className="block text-[13px] text-muted-foreground">
                  {existing?.isDefault ? "To change the default, make another tier the default." : "New accounts and accounts without a tier use it. There is always exactly one default."}
                </span>
              </span>
              <Switch checked={d.isDefault} onCheckedChange={(v) => setD((x) => ({ ...x, isDefault: v }))} disabled={!!existing?.isDefault} data-testid="tier-default" />
            </label>
            {error ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok} loading={save.isPending} data-testid="tier-save">
              {existing ? "Save" : "Add tier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
