/** The /admin control plane. Re-exported from index.ts. */
import type { UserRole, UserStatus, UserSummary } from "./index";
import type { QuotaLimits } from "./quota";

export type ProviderKind = "OPENAI" | "ANTHROPIC" | "GEMINI" | "OPENAI_COMPATIBLE" | "STUB";
export type ModelKind = "TEXT";

/** GET /api/admin/me. */
export interface AdminSession {
  role: UserRole;
}

// ─── Overview ───────────────────────────────────────────────────────────────

/** GET /api/admin/stats?from=&to=: the overview, UTC days. */
export interface AdminStats {
  from: string;
  to: string;
  totals: { users: number; newUsers: number; activeUsers: number; runs: number };
  /** New sign-ups per UTC day. Runs are counted per month, see `byKind`. */
  daily: { date: string; newUsers: number }[];
  /** AI runs by kind over the months the range touches. */
  byKind: { kind: string; runs: number }[];
}

// ─── Users ──────────────────────────────────────────────────────────────────

export interface AdminUserRow extends UserSummary {
  email: string;
  status: UserStatus;
  quotaTier: { id: string; name: string } | null;
  createdAt: string;
  lastSeenAt: string | null;
  suspendedUntil: string | null;
  /** AI runs used this month (UTC). */
  runsThisMonth: number;
}

export interface AdminUserDetail extends AdminUserRow {
  override: QuotaOverride | null;
  /** The last 6 UTC months, newest first. */
  usage: { month: string; runs: number }[];
  /** The limits that apply right now (tier plus override). */
  limits: QuotaLimits;
}

export interface QuotaOverride {
  monthlyRuns: number | null;
  maxResumes: number | null;
  maxUploadMb: number | null;
  note: string | null;
  updatedAt: string;
}

export interface QuotaTier {
  id: string;
  name: string;
  /** Null means unlimited. */
  monthlyRuns: number | null;
  maxResumes: number | null;
  maxUploadMb: number | null;
  isDefault: boolean;
  userCount: number;
}

// ─── Providers and models ───────────────────────────────────────────────────

export interface AdminProvider {
  id: string;
  kind: ProviderKind;
  displayName: string;
  baseUrl: string | null;
  enabled: boolean;
  /** Whether a key for this provider is configured on the server. Never the key itself. */
  keyConfigured: boolean;
  modelCount: number;
}

export interface AdminModel {
  id: string;
  providerId: string;
  kind: ModelKind;
  modelRef: string;
  displayName: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
}

/** POST /api/admin/models/:id/test: one tiny call through the real provider. */
export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  /** A short, key-free description of what happened. */
  message: string;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface AppSettings {
  appName: string;
  tagline: string;
  registration: "OPEN" | "INVITE_ONLY" | "CLOSED";
  /** Email domains allowed to sign up when registration is INVITE_ONLY (["example.com"]). */
  allowedEmailDomains: string[];
  supportEmail: string | null;
  /** Server-side addition to every AI system prompt (house rules, tone). */
  systemPromptAddendum: string;
  features: Record<string, boolean>;
  minSupportedVersion: string | null;
}

/** What this deployment has configured. Never a key. */
export interface IntegrationStatus {
  mail: { mode: "outbox" | "smtp" | "ses" };
  storage: { mode: "local" | "s3" };
  /** Whether at least one text model of a usable provider exists (otherwise the offline engine runs). */
  ai: { providerConfigured: boolean };
}

// ─── Audit ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  actor: UserSummary | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}
