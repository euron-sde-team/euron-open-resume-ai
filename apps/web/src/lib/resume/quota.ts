/**
 * One reading of GET /me/usage for the screens. The contract's shape
 * ({ runs:{used,limit,resetsAt}, resumes:{count,limit}, maxUploadMb, tier }) and the
 * shell's ({ runs:{used,limit}, limits:{maxResumes,maxUploadMb}, resetsAt }) are both
 * understood, so the screens do not depend on which one the API settles on.
 */
export interface QuotaView {
  used: number;
  /** Null means unlimited. */
  limit: number | null;
  /** Null when unlimited. */
  left: number | null;
  exhausted: boolean;
  resetsAt: string | null;
  resumesCount: number | null;
  resumesLimit: number | null;
  maxUploadMb: number | null;
  tierName: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function quotaView(raw: unknown): QuotaView {
  const u = rec(raw);
  const runs = rec(u.runs);
  const resumes = rec(u.resumes);
  const limits = rec(u.limits);
  const used = num(runs.used) ?? 0;
  const limit = num(runs.limit) ?? num(limits.monthlyRuns);
  const resetsAtRaw = runs.resetsAt ?? u.resetsAt;
  return {
    used,
    limit,
    left: limit === null ? null : Math.max(0, limit - used),
    exhausted: limit !== null && used >= limit,
    resetsAt: typeof resetsAtRaw === "string" ? resetsAtRaw : null,
    resumesCount: num(resumes.count),
    resumesLimit: num(resumes.limit) ?? num(limits.maxResumes),
    maxUploadMb: num(u.maxUploadMb) ?? num(limits.maxUploadMb),
    tierName: typeof rec(u.tier).name === "string" ? (rec(u.tier).name as string) : null,
  };
}

export function formatResetDate(iso: string | null, locale?: string): string {
  if (!iso) return "the start of next month";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the start of next month";
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(d);
}

/** "12 runs left this month", "1 run left this month", or null when the allowance is unlimited. */
export function runsLeftText(q: QuotaView): string | null {
  if (q.left === null) return null;
  return `${q.left} ${q.left === 1 ? "run" : "runs"} left this month`;
}

/** True when a thrown API error is the monthly-runs-used-up refusal. */
export function isQuotaError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "QUOTA_EXHAUSTED" || code === "QUOTA_EXCEEDED";
}
