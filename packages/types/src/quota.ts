/** Monthly AI run allowances and per-user preferences. Re-exported from index.ts. */

/** The resolved limits for one user. Null means unlimited. */
export interface QuotaLimits {
  monthlyRuns: number | null;
  maxResumes: number | null;
  maxUploadMb: number | null;
}

/** GET /api/me/usage: this month's use against the allowance (UTC calendar month). */
export interface Usage {
  /** The month, "2026-11". */
  month: string;
  runs: { used: number; limit: number | null; resetsAt: string };
  /** Resumes held now against the cap. */
  resumes: { count: number; limit: number | null };
  /** The upload size cap in MB for this user (also capped at 10 MB by the API); null means the API cap. */
  maxUploadMb: number | null;
  /** The quota tier the user is on (null when on none and no default exists). */
  tier: { id: string; name: string } | null;
  /** Runs by kind this month ("analyze", "improve", ...). */
  byKind: Record<string, number>;
  limits: QuotaLimits;
  /** When the counter resets (ISO, the first moment of next month UTC). */
  resetsAt: string;
}

/** GET/PATCH /api/me/preferences. */
export interface Preferences {
  /** The template the picker preselects; null means the app default. */
  defaultTemplate: string | null;
}
