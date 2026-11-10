"use client";

import { cn } from "@open-resume/ui";
import { formatResetDate, quotaView, runsLeftText, type QuotaView } from "@/lib/resume/quota";
import { useUsage } from "@/lib/queries";

/** The usage reading for a screen, from the cached /me/usage. */
export function useQuota(): { quota: QuotaView; ready: boolean } {
  const { data } = useUsage();
  return { quota: quotaView(data), ready: data !== undefined };
}

/**
 * How many runs are left, as one muted line; when they are used up, the plain statement of
 * when they come back. Announced politely, never a modal.
 */
export function QuotaNotice({ quota, className, cost }: { quota: QuotaView; className?: string; cost?: boolean }) {
  if (quota.exhausted) {
    return (
      <p role="status" data-testid="quota-exhausted" className={cn("text-[13.5px] font-medium text-danger", className)}>
        Monthly runs used up. They reset on {formatResetDate(quota.resetsAt)}. You can still read, edit and download what you have.
      </p>
    );
  }
  const left = runsLeftText(quota);
  if (!left) return null;
  const low = quota.limit !== null && quota.left !== null && quota.left <= Math.max(1, Math.floor(quota.limit * 0.1));
  return (
    <p role="status" data-testid="quota-left" className={cn("text-[13px]", low ? "font-medium text-warning" : "text-muted-foreground", className)}>
      {left}
      {cost ? ". This uses one." : null}
    </p>
  );
}

/** A section that should read as unavailable while the runs are used up. */
export function QuotaGate({ quota, children }: { quota: QuotaView; children: React.ReactNode }) {
  return (
    <>
      <QuotaNotice quota={quota} cost />
      <div className={quota.exhausted ? "pointer-events-none opacity-60" : undefined} aria-disabled={quota.exhausted || undefined}>
        {children}
      </div>
    </>
  );
}
