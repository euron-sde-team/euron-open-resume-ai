# Data model

The schema is [`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql) (identity,
quotas, providers and models, settings, audit) plus
[`0002_resumes.sql`](../../db/migrations/0002_resumes.sql) (resumes, per-component pipeline
state, builder drafts), applied by [`db/migrate.ts`](../../db/migrate.ts). Runtime queries use
Kysely with types generated into [`apps/api/src/db/types.ts`](../../apps/api/src/db/types.ts)
([ADR 0009](adr/0009-sql-migrations-with-kysely-types.md)). This page groups the tables by
domain and explains why each exists and which constraints carry a rule.

## Conventions

- **Keys** are ULIDs stored as `text`, generated in the API
  ([`core/ids.ts`](../../apps/api/src/core/ids.ts)). They sort by creation time and break ties
  in keyset cursors. Exceptions: `providers.id` is the provider's slug (it is also the key
  into `PROVIDER_KEYS`), and `usage_monthly`, `user_preferences`, `user_quota_overrides`,
  `resume_components` and `totp_recovery_codes` use natural or composite keys.
- **Timestamps** are `timestamptz(3)`, and processes run with `TZ=UTC`. Millisecond precision
  is what a JS `Date` holds, so a cursor round-trips exactly.
- **Lists page with keyset cursors**, never `OFFSET`; each list has an index serving its order.
- **Text limits** are `CHECK (length(...))` in the schema and matched by zod in the API.
- **Enums** are PostgreSQL enum types.
- **Extensions**: `citext` (email, username) and `pg_trgm` (admin user search).
- **No tenant column.** One deployment serves one organisation
  ([ADR 0001](adr/0001-single-deployment.md)).
- **No provider keys.** They live in the environment or Secrets Manager only.
- **Usage rows hold counts only**, never resume or prompt text.
- **Ownership.** Every resume and draft row has `user_id`, and every query filters on it.
- **Migrations** are forward-only. The runner records each file's name and SHA-256 in
  `schema_migrations` and refuses to continue if an applied file was edited. A Postgres
  advisory lock (`727101`) serialises concurrent runs. Each file runs in its own transaction.

## Enums

| Enum | Values |
| --- | --- |
| `user_role` | `USER`, `ADMIN` |
| `user_status` | `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `BANNED`, `DEACTIVATED` |
| `auth_token_type` | `VERIFY_EMAIL`, `RESET_PASSWORD` |
| `provider_kind` | `OPENAI`, `ANTHROPIC`, `GEMINI`, `OPENAI_COMPATIBLE`, `STUB` |
| `model_kind` | `TEXT` (the only value; resume tasks need text models) |
| `resume_source` | `upload`, `builder` |
| `resume_status` | `queued`, `processing`, `analyzed`, `error` |
| `resume_component_kind` | `analysis`, `rewrite`, `interview_non_technical`, `interview_dsa`, `interview_programming`, `interview_system_design`, `roadmap`, `projects` |
| `resume_component_status` | `pending`, `processing`, `done`, `failed`, `skipped` |

`skipped` is part of the enum and the status logic treats it like `done`, but no code path
sets it today.

## Tables by domain

### Identity

| Table | Purpose and notable constraints |
| --- | --- |
| `users` | The account. `email` and `username` are `citext UNIQUE`; `username` matches `^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$`; `display_name` is cleaned at write time and may not be an email or a phone number. `password_hash` is bcrypt. `totp_secret` is AES-256-GCM ciphertext, never the raw secret; `totp_last_step` makes a code work once. `token_version` is bumped to invalidate every access token. `quota_tier_id` is `ON DELETE SET NULL` (the default tier applies). `deletion_requested_at` starts the 14-day grace period. Indexes: a trigram GIN index over `display_name + username + email` (admin search) and a partial index on non-`USER` roles |
| `sessions` | One refresh token per row. `token_hash` (SHA-256) is unique. `family_id` groups every rotation of one login so reuse can revoke the lot; `replaced_by` marks a rotated token; `ip` is `inet`. Cascades from `users`. Indexes: active sessions per user (partial, `revoked_at IS NULL`) and by family |
| `auth_tokens` | Email-verification and password-reset links, stored as hashes, with `expires_at` and `used_at`. Unique `token_hash` |
| `totp_recovery_codes` | Ten single-use codes per enrolment. Primary key `(user_id, code_hash)`; only an HMAC of each code is stored |
| `user_preferences` | One row per user: `default_template`, validated against the template list in code. A missing row means defaults |

### Quotas and usage

| Table | Purpose and notable constraints |
| --- | --- |
| `quota_tiers` | Named allowances: `monthly_runs`, `max_resumes`, `max_upload_mb` (1 to 500). `NULL` means unlimited. A partial unique index `quota_tiers_one_default` (`WHERE is_default`) allows exactly one default tier. A `Default` tier (20 runs, 10 resumes, 10 MB) is seeded by the migration |
| `user_quota_overrides` | One user's numbers on top of their tier. `NULL` columns fall back to the tier. `note` and `updated_by` record why |
| `usage_monthly` | One row per `(user_id, month, kind)`; `month` is the first day of the UTC month; `kind` is `analyze`, `interview`, `roadmap`, `projects` or `builder`; `runs >= 0`. Counts only. Index on `month` for the admin overview |

### Providers and models

| Table | Purpose and notable constraints |
| --- | --- |
| `providers` | An endpoint. `id` is a slug (`^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`) and is the lookup key into `PROVIDER_KEYS`. `base_url` empty means the kind's default |
| `models` | The catalogue the runtime reads. `model_ref` is the provider's id; `context_window` and `max_output_tokens` bound requests; `is_default` is unique per `kind` through the partial index `models_one_default_per_kind`; `UNIQUE (provider_id, model_ref, kind)`. Cascades from `providers` |

### Resumes

| Table | Purpose and notable constraints |
| --- | --- |
| `resumes` | One resume. `source` is `upload` or `builder`; `status` is derived from the components and stored so lists do not join; `file_key`, `file_name`, `file_mime`, `file_size` describe the stored original; `jd` (at most 20,000 characters) and `company` (120) are the optional target job; `is_tailored` and `parent_id` link a tailored copy to its source (`ON DELETE SET NULL`); `template_id` is the chosen template; `score` is 0 to 100. Indexes: `(user_id, updated_at DESC, id DESC)` serves the list; a partial index on `parent_id` |
| `resume_components` | One row per AI unit of work, primary key `(resume_id, kind)`, cascades from `resumes`. `status` is the user-visible state; `claimed_at` separates queued from running; `attempts` counts worker attempts of the current request; `charged` is the runs taken for it (given back if it finally fails); `error` is a message safe to show; `data` holds the result of interview, roadmap and projects components |
| `resume_drafts` | A `ResumeDocument` being edited in the builder. `document` is JSONB. The API caps a user at 50 under an advisory lock. Index `(user_id, updated_at DESC, id DESC)` |

### Operations

| Table | Purpose and notable constraints |
| --- | --- |
| `settings` | Key-value JSONB. One row, `key = 'app'`, holds `AppSettings` (name, tagline, registration mode, allowed domains, support email, minimum app version) |
| `audit_log` | Append-only. `actor_id` is `ON DELETE SET NULL`; `data` is JSONB with ids and counts, never content. Indexes: recent (`created_at DESC, id DESC`), by entity, by actor |
| `schema_migrations` | Created by the runner, not by a migration file: `name`, `checksum`, `applied_at` |

## What is JSONB and why

| Column | Shape | Why JSONB |
| --- | --- | --- |
| `resumes.original`, `resumes.improved` | `ResumeDocument` | A resume is a tree of sections with variable length. It is always read and written whole, rendered whole and sent to a model whole; nothing queries inside it. Normalising it into tables would add joins and migrations for no query |
| `resumes.analysis` | `{ before, after }` (`ResumeAnalysis`: each an `AnalysisReport` with score, summary, keyword report, formatting and content notes, readability, strengths, weaknesses, repetitive phrases, improvements) | Produced by one AI call and shown as a unit |
| `resumes.cover_letter` | `CoverLetter` | Same |
| `resume_components.data` | `InterviewGroup[]`, `CareerRoadmap` or `ProjectIdea[]` | One shape per component kind; read only by id and kind |
| `resume_drafts.document` | `ResumeDocument` | A draft is a half-finished document |
| `settings.value`, `audit_log.data` | Free-form | Settings merge key by key; audit payloads vary per action |

The shapes are defined in [`packages/types/src/resume.ts`](../../packages/types/src/resume.ts)
and enforced on every write by zod, not by the database. Documents are also capped by the
normalisers (for example 25 to 30 experience entries, 30 bullets per entry) so a hostile or
runaway document cannot grow without bound, and NUL bytes are stripped because they break
JSONB. `score` is duplicated out of `analysis` into its own column so lists can show and sort
it without parsing JSON.

## Relationships

```
users 1--N sessions, auth_tokens, totp_recovery_codes
users 1--1 user_preferences, user_quota_overrides
users N--1 quota_tiers (SET NULL)
users 1--N usage_monthly
users 1--N resumes 1--N resume_components
resumes N--1 resumes (parent_id, SET NULL)
users 1--N resume_drafts
providers 1--N models
users 1--N audit_log (actor_id, SET NULL)
```

Deleting a user is never a hard delete in normal operation. `anonymiseUser`
([`account.service.ts`](../../apps/api/src/services/account.service.ts)) keeps the `users`
row (audit rows and usage history point at it), rewrites the email to
`deleted+<id>@invalid.example`, replaces the password with an unknown one, removes TOTP,
sessions, tokens, preferences, overrides, usage rows, drafts and resumes, and deletes the
stored files after the transaction commits.

## Seed data

The migration seeds one row: the `Default` quota tier. The API seeds the provider and model
catalogue on first boot when `providers` is empty
([`demo/catalog.ts`](../../apps/api/src/demo/catalog.ts)): `openai`, `anthropic` and `gemini`
with a few models each. A provider without a key is simply not offered, so the catalogue is
invisible to the runtime until a key is set. `make demo` additionally lists a stub
provider (disabled until an admin switches it on) outside production.
