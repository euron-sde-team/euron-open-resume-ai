-- Euron Open Resume AI: base schema (identity, quotas, AI providers and models, settings, audit).
-- The resume tables arrive in 0002.
--
-- Conventions
--   * Primary keys are ULIDs stored as text (sortable by creation time).
--   * Timestamps are timestamptz(3); the API runs with TZ=UTC.
--   * Lists page with keyset cursors, never OFFSET.
--   * One deployment serves one organisation or community: there is no tenant column.
--   * Provider API keys never live in this database. They come from the environment or
--     Secrets Manager (core/config.ts PROVIDER_KEYS), and no endpoint ever returns one.
--   * Usage rows hold counts and model ids only, never resume or prompt text.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Enums ──────────────────────────────────────────────────────────────────

-- USER: everyone. ADMIN: the control plane (users, models, quotas, settings, audit).
CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED');
CREATE TYPE auth_token_type AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- OPENAI_COMPATIBLE covers Groq, OpenRouter, Together, DeepInfra, Ollama, vLLM, LM Studio
-- and anything else that speaks the Chat Completions wire format.
CREATE TYPE provider_kind AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE', 'STUB');
-- What a model is used for. Resume tasks only need text models.
CREATE TYPE model_kind AS ENUM ('TEXT');

-- ─── Identity ───────────────────────────────────────────────────────────────

-- Quota tiers. Every user is on one (or the default); admins create as many as they like
-- ("Default", "Staff", "Research") and may override one user's numbers on top.
-- NULL means unlimited.
CREATE TABLE quota_tiers (
  id             text PRIMARY KEY,
  name           text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
  monthly_runs   integer CHECK (monthly_runs >= 0),
  max_resumes    integer CHECK (max_resumes >= 0),
  max_upload_mb  integer CHECK (max_upload_mb BETWEEN 1 AND 500),
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz(3) NOT NULL DEFAULT now(),
  updated_at     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quota_tiers_one_default ON quota_tiers (is_default) WHERE is_default;

CREATE TABLE users (
  id                    text PRIMARY KEY,
  email                 citext NOT NULL UNIQUE,
  username              citext NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$'),
  -- Cleaned at write time (domain/display-name.ts): never an email address or a phone number.
  display_name          text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash         text NOT NULL,
  role                  user_role NOT NULL DEFAULT 'USER',
  status                user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at     timestamptz(3),
  totp_secret           text,                    -- AES-256-GCM ciphertext (security/totp.ts), never the raw secret
  totp_enabled          boolean NOT NULL DEFAULT false,
  totp_last_step        bigint,                  -- last accepted TOTP time step: a code works once
  suspended_until       timestamptz(3),
  token_version         integer NOT NULL DEFAULT 0,
  quota_tier_id         text REFERENCES quota_tiers (id) ON DELETE SET NULL,
  -- Set when the user asks to delete the account; the purge job erases it after the
  -- grace period unless they sign in and cancel.
  deletion_requested_at timestamptz(3),
  last_seen_at          timestamptz(3),
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX users_name_trgm_idx ON users USING gin ((display_name || ' ' || username::text || ' ' || email::text) gin_trgm_ops);
CREATE INDEX users_admin_idx ON users (role) WHERE role <> 'USER';

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    text NOT NULL,                  -- every rotation of one login shares a family
  token_hash   text NOT NULL UNIQUE,           -- sha256 of the refresh token
  user_agent   text,
  ip           inet,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_used_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at   timestamptz(3) NOT NULL,
  revoked_at   timestamptz(3),
  replaced_by  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE auth_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, type);

-- Single-use two-factor recovery codes, issued ten at a time when TOTP is turned on.
-- Only an HMAC of each code is stored (keyed from TOTP_ENCRYPTION_KEY).
CREATE TABLE totp_recovery_codes (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

-- ─── Providers and models ───────────────────────────────────────────────────

-- A provider is an endpoint. Its key is looked up by slug in PROVIDER_KEYS at call time.
CREATE TABLE providers (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),   -- the slug
  kind         provider_kind NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  base_url     text CHECK (length(base_url) <= 300),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  updated_at   timestamptz(3) NOT NULL DEFAULT now()
);

-- The one model catalogue the runtime reads. Resume AI tasks resolve the default
-- enabled model (or the one an admin pins for a task) from here.
CREATE TABLE models (
  id                 text PRIMARY KEY,
  provider_id        text NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  kind               model_kind NOT NULL DEFAULT 'TEXT',
  model_ref          text NOT NULL CHECK (length(model_ref) BETWEEN 1 AND 120),   -- the provider's model id
  display_name       text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  description        text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  context_window     integer NOT NULL DEFAULT 128000 CHECK (context_window > 0),
  max_output_tokens  integer NOT NULL DEFAULT 4096 CHECK (max_output_tokens > 0),
  enabled            boolean NOT NULL DEFAULT true,
  is_default         boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  updated_at         timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_ref, kind)
);
CREATE UNIQUE INDEX models_one_default_per_kind ON models (kind) WHERE is_default;

-- Per-user preferences (missing row = defaults, presenters/preferences.presenter.ts).
CREATE TABLE user_preferences (
  user_id           text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- A template id the picker preselects; validated against the template list in code.
  default_template  text CHECK (length(default_template) <= 60),
  updated_at        timestamptz(3) NOT NULL DEFAULT now()
);

-- ─── Quotas and usage ───────────────────────────────────────────────────────

-- One user's numbers on top of their tier. NULL columns fall back to the tier.
CREATE TABLE user_quota_overrides (
  user_id        text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  monthly_runs   integer CHECK (monthly_runs >= 0),
  max_resumes    integer CHECK (max_resumes >= 0),
  max_upload_mb  integer CHECK (max_upload_mb BETWEEN 1 AND 500),
  note           text CHECK (length(note) <= 300),
  updated_by     text REFERENCES users (id) ON DELETE SET NULL,
  updated_at     timestamptz(3) NOT NULL DEFAULT now()
);

-- AI runs per user, calendar month (UTC; `month` is the first day) and kind
-- ("analyze", "improve", "cover-letter", ...). Counts only, never content.
CREATE TABLE usage_monthly (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month   date NOT NULL,
  kind    text NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  runs    integer NOT NULL DEFAULT 0 CHECK (runs >= 0),
  PRIMARY KEY (user_id, month, kind)
);
CREATE INDEX usage_monthly_month_idx ON usage_monthly (month);

-- ─── Operations ─────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- ─── Seed rows ──────────────────────────────────────────────────────────────

-- The default tier: enough to try every feature, small enough to protect a provider key.
INSERT INTO quota_tiers (id, name, monthly_runs, max_resumes, max_upload_mb, is_default)
VALUES ('01JDK4V7Q80000000000000000', 'Default', 20, 10, 10, true);
