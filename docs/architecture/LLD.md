# Low-level design

How the code is laid out and why. The system as a whole is in [HLD.md](HLD.md). Paths are
relative to the repository root.

## 1. Layout

```
apps/api/                    Express 5 API, worker, CLI
  src/index.ts               HTTP server entry
  src/worker.ts              BullMQ workers + schedules
  src/cli.ts                 admin:create, demo:seed
  src/app.ts                 middleware stack and error handler
  src/routes/                one router per area, mounted in routes/index.ts
  src/controllers/           parse input, call a service, shape the response
  src/services/              business rules, transactions, quotas
    resume/                  the resume domain (pipeline, ai/, render/, extract)
  src/repositories/          Kysely queries, one class per table family
  src/presenters/            database row -> DTO
  src/domain/                pure functions (username and display-name rules)
  src/integrations/          llm/, mail/, storage, redis, http
  src/security/              passwords, tokens, totp
  src/middleware/            auth, rate-limit, multipart, http helpers
  src/jobs/                  registry, resume jobs, maintenance jobs
  src/core/                  config, errors, ids, logger, context, effects, validate
  src/db/                    Kysely pool, generated types, connection config
  src/templates/             13 resume EJS templates + cover_letter.ejs
  src/demo/                  starter model catalogue and the demo seed
apps/web/                    Next.js 15 app (React 19, TanStack Query v5)
apps/stubs/                  dependency-free OpenAI-compatible stub
packages/{types,api-client,ui,samples}
db/migrate.ts, db/migrations/0001_init.sql, 0002_resumes.sql
infra/{docker,terraform}, deploy/compose, scripts/, e2e/
```

## 2. Layers and conventions

```
route -> controller -> service -> repository -> Kysely -> PostgreSQL
                         |-> integrations (storage, llm, mail, redis)
                         |-> jobs (enqueue after commit)
```

| Layer | Rule | Example |
| --- | --- | --- |
| Route | Declares the path, the rate limiter and `authenticate`; no logic. A comment above each route documents the contract, and [`scripts/gen-openapi.ts`](../../scripts/gen-openapi.ts) turns routes into [`docs/api/openapi.yaml`](../api/openapi.yaml) | [`routes/resumes.routes.ts`](../../apps/api/src/routes/resumes.routes.ts) |
| Controller | Parses `req.body`, `req.query` and `req.params` with zod through `parse()` (a failure is a 400 `VALIDATION_FAILED` naming the field), calls one service function, sets headers and status | [`controllers/resume.controller.ts`](../../apps/api/src/controllers/resume.controller.ts) |
| Service | Takes an `Actor` (never an Express request), enforces ownership and status, owns transactions, charges quotas, enqueues jobs | [`services/resume/resume.service.ts`](../../apps/api/src/services/resume/resume.service.ts) |
| Repository | Kysely only, one class per table family, a singleton, every method takes an optional `Executor` so it can run inside a transaction | [`repositories/resume.repository.ts`](../../apps/api/src/repositories/resume.repository.ts) |
| Presenter | Converts a row to the DTO from `packages/types`; the only place a column name becomes an API field | [`presenters/resume.presenter.ts`](../../apps/api/src/presenters/resume.presenter.ts) |
| Integration | One file or folder per outside system; nothing above the integration knows which provider answered | [`integrations/llm/`](../../apps/api/src/integrations/llm/index.ts) |

Express 5 forwards rejected promises from async handlers to the error middleware, so
controllers do not wrap handlers.

**Errors.** [`core/errors.ts`](../../apps/api/src/core/errors.ts) defines `HttpError(status,
message, code, details)` and helpers (`badRequest`, `unauthenticated`, `forbidden`,
`notFound`, `conflict`, `unprocessable`, `tooMany`). The handler in `app.ts` answers
`{ error, code, details?, requestId }`. Unknown errors become 500 `INTERNAL` with the request
id and no detail; malformed JSON and oversized bodies are `BAD_REQUEST` and
`PAYLOAD_TOO_LARGE`. Clients switch on `code`, never on `error`.

**IDs and time.** ULIDs as `text` ([`core/ids.ts`](../../apps/api/src/core/ids.ts)),
`timestamptz(3)`, processes run with `TZ=UTC`. Lists use keyset cursors
([`repositories/keyset.ts`](../../apps/api/src/repositories/keyset.ts)): an opaque base64url
`[timestamp, id]` pair, one extra row fetched to know whether a next page exists, never
`OFFSET` or `COUNT(*)`.

**After-commit effects.** `withTransaction(async (trx, fx) => ...)` in
[`core/effects.ts`](../../apps/api/src/core/effects.ts) collects job enqueues and other side
effects with `fx.job(...)` and `fx.after(...)` and runs them only after the commit. A failing
effect is logged and never fails the request. The resume pipeline uses it so nothing is
queued for a rolled-back insert.

**Validation sources.** Request bodies are validated in the controller with zod. The resume
document has one tolerant schema, `documentSchema` in
[`services/resume/ai/document.ts`](../../apps/api/src/services/resume/ai/document.ts), used on
request bodies (render, export, drafts, from-document), on model output and on stored
documents. A second normaliser exists in
[`services/resume/document.ts`](../../apps/api/src/services/resume/document.ts); see
[rendering-and-templates.md](rendering-and-templates.md#1-the-canonical-document).

## 3. The request pipeline

Order in [`app.ts`](../../apps/api/src/app.ts):

| # | Middleware | Purpose |
| --- | --- | --- |
| 1 | Request id | Accepts a safe incoming `x-request-id` (`[\w-]{8,64}`), else generates a ULID; echoed in the `X-Request-Id` header |
| 2 | `pino-http` | Access log; `/up` and `/api/ready` are not logged; signed local-file tokens in URLs are masked |
| 3 | Helmet | `default-src 'none'`, `frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: cross-origin` |
| 4 | CORS | Credentials only for `CORS_ORIGINS` (default `APP_WEB_URL`) |
| 5 | Origin check | A non-GET request carrying a foreign `Origin` is `403 CORS_ORIGIN_DENIED` |
| 6 | `cookie-parser`, `express.json({ limit: "2mb" })` | Files never come through JSON |
| 7 | `/up`, `/api/ready` | Liveness and readiness (Postgres `select 1` plus Redis `PING`) |
| 8 | Routers | Mounted from `MOUNTS` in [`routes/index.ts`](../../apps/api/src/routes/index.ts) |
| 9 | 404, error handler | As above |

[`middleware/auth.ts`](../../apps/api/src/middleware/auth.ts) `authenticate` verifies the
bearer JWT, then **reloads the user** and compares `token_version`, so a ban, a password
change or "sign out everywhere" takes effect on the next request. A timed suspension that has
run out is lifted lazily there as well as by the sweep job.

## 4. Auth and sessions

[`services/auth.service.ts`](../../apps/api/src/services/auth.service.ts),
[`security/`](../../apps/api/src/security/tokens.ts), [`controllers/auth.controller.ts`](../../apps/api/src/controllers/auth.controller.ts).

| Item | Behaviour |
| --- | --- |
| Access token | HS256 JWT, 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`), audience `open-resume`, issuer `open-resume-api`, claims `sub` and `ver` |
| Refresh token | 32 random bytes in the `httpOnly` cookie, 30 days (`REFRESH_TOKEN_TTL_DAYS`), `SameSite=Lax`, `Path=/api/auth`, `Secure` when the app URL is https. Only its SHA-256 is stored in `sessions.token_hash` |
| Rotation | Each refresh revokes the presented session and issues a new row in the same `family_id`. A rotated token presented 10 s or more later revokes the whole family and audits `session.reuse_detected` |
| Native clients | With `X-Client: native` the refresh token is in the body and no cookie is set |
| Sign-in | Email or username. Failures are throttled, not locked: 5 per account and IP per 15 minutes and 50 per account per hour, then `429` for everyone alike. Unknown logins burn a bcrypt compare so timing does not enumerate accounts |
| Two-factor | TOTP (RFC 6238) with an AES-256-GCM encrypted secret (HKDF key, user id as AAD), one-use steps, ten single-use recovery codes stored as HMACs |
| Verification and reset | 24 h and 1 h single-use links, stored as hashes in `auth_tokens`; a reset revokes every session and bumps `token_version` |
| Registration | `settings.registration`: `OPEN`, `INVITE_ONLY` (allowed email domains) or `CLOSED` |

## 5. Rate limits

[`middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts) uses
`rate-limiter-flexible` on Redis so every API task shares a budget. Each Redis limiter has an
in-memory insurance limiter with the same budget, used when Redis is not ready (the budget is
then per task, and requests do not fail). The subject is `u:<user id>` when signed in, else
`ip:<ip>`. A limiter is keyed by its name, so routes that share a name share a bucket. Limits
under `RATE_LIMITS=off` (the default under `NODE_ENV=test`) are disabled.

| Name | Budget | Routes |
| --- | --- | --- |
| `auth` | 10 per 60 s per IP | sign-up, verify-email, login, reset-password, change-password, TOTP enable, disable, recovery codes |
| `auth-mail` | 5 per hour per IP | resend-verification, forgot-password |
| `auth-refresh` | 60 per 60 s per IP | refresh |
| `resume-create` | 20 per hour per user | `POST /resumes`, `POST /resumes/from-document`, `POST /resumes/:id/tailor` (one shared bucket) |
| `resume-ai` | 30 per hour per user | `POST /resumes/:id/retry`, `POST /resumes/:id/components/:kind` |
| `resume-download` | 40 per 60 s | `GET /resumes/:id/download/:what` |
| `resume-render` | 120 per 60 s | `GET /resumes/:id/render` |
| `builder-chat` | 20 per 60 s | `POST /builder/chat` |
| `builder-import` | 6 per 60 s | `POST /builder/import` |
| `builder-render` | 120 per 60 s | `POST /builder/render` |
| `builder-export` | 20 per 60 s | `POST /builder/export` |
| `draft-write` | 120 per 60 s | draft create and update |
| `account-delete` | 5 per hour | `DELETE /users/me` |
| `account-export` | 3 per day | `GET /users/me/export` |
| `admin-erase` | 20 per hour | admin erase |
| `admin-model-test` | 20 per 60 s | admin model test |

Rate limits are a separate layer from quotas ([quotas.md](quotas.md)).

## 6. Modules

### Auth and account (`/api/auth`, `/api/users`)

Sign-up, sign-in, refresh, sign-out, verification, reset, change password and TOTP are in
`auth.service.ts`. `account.service.ts` owns the account lifecycle: `DELETE /api/users/me`
sets `deletion_requested_at`, signs the user out everywhere, and the
`maintenance.purge-accounts` job runs `anonymiseUser` after 14 days unless the user signs in
again. `GET /api/users/me/export` streams one JSON document of the caller's resumes (with
components nested) and drafts, 500 rows at a time. Sessions are listed and revoked under
`/api/users/me/sessions`.

### Resumes (`/api/resumes`)

[`services/resume/resume.service.ts`](../../apps/api/src/services/resume/resume.service.ts)
holds create (upload and from-document), tailor, list, get, status, retry, generate a
component, delete, download and render. Every function takes an `Actor`; writes call
`requireActive`, reads call `requireActor`. The charge-store-insert-enqueue order and the
refund rules are in [resume-pipeline.md](resume-pipeline.md) and [quotas.md](quotas.md).

| Endpoint | Does |
| --- | --- |
| `POST /api/resumes` | Upload, charge one run, queue the analysis. 202 |
| `POST /api/resumes/from-document` | Same, for a document built in the builder |
| `GET /api/resumes`, `GET /api/resumes/:id`, `GET /api/resumes/:id/status` | List (keyset), detail, cheap status for polling. `no-store`. Reading may reap stale components |
| `POST /api/resumes/:id/retry` | Re-run failed steps, one run per job |
| `POST /api/resumes/:id/tailor` | A new resume (with `parent_id`) analysed against a job description |
| `POST /api/resumes/:id/components/:kind` | Generate one more interview track, the roadmap or project ideas |
| `DELETE /api/resumes/:id` | Delete row, components (cascade) and the stored file after commit |
| `GET /api/resumes/:id/download/:what` | `original`, `resume.pdf`, `resume.docx`, `cover-letter.pdf`, `cover-letter.docx`; `?template=` re-renders |
| `GET /api/resumes/:id/render` | Self-contained HTML for the sandboxed iframe |

### Builder (`/api/builder`, `/api/templates`, `/api/drafts`)

[`controllers/builder.controller.ts`](../../apps/api/src/controllers/builder.controller.ts)
renders and exports a document that arrives in the request body (512 KB cap), with no AI and
no quota. [`builder-ai.controller.ts`](../../apps/api/src/controllers/builder-ai.controller.ts)
runs the chat builder and the import route: each charges one run before the model is called
and refunds if the work fails on our side. Drafts
([`draft.service.ts`](../../apps/api/src/services/resume/draft.service.ts)) are a
`ResumeDocument` being edited, capped at 50 per user under an advisory lock.

### Quotas (`/api/me`)

[`services/quota.service.ts`](../../apps/api/src/services/quota.service.ts). `GET
/api/me/usage` returns this month's runs against the allowance, the resumes held, the tier and
the per-kind breakdown. Preferences (`default_template`) live under `/api/me/preferences`.

### Admin (`/api/admin`)

[`services/admin.service.ts`](../../apps/api/src/services/admin.service.ts): overview stats,
accounts (search, status and role changes, suspend, ban, erase, tier, per-user override),
tiers, providers, models (with a one-call test), settings, integrations status and the audit
log. Every function starts with `requireAdmin`. `LAST_ADMIN` and `SELF_ACTION` guard the
obvious foot-guns. Mutations are audited in the same transaction.

### Models and settings

[`services/models.service.ts`](../../apps/api/src/services/models.service.ts) is the one
catalogue the runtime reads ([ai-engine.md](ai-engine.md#1-provider-resolution)).
[`settings.service.ts`](../../apps/api/src/services/settings.service.ts) keeps one JSON
document under `settings.key = 'app'`, merged over defaults and cached for 5 seconds per
process; `GET /api/meta` serves the public part (name, tagline, registration mode, default
upload limit, minimum app version).

### Audit

[`audit.service.ts`](../../apps/api/src/services/audit.service.ts) appends a row inside the
transaction of the change it records. Actions include `user.signup`, `user.login`,
`user.role`, `user.tier`, `user.export`, `user.deletion_requested`, `user.purged`,
`session.reuse_detected`, `resume.create`, `resume.tailor`, `resume.delete`, `tier.save`,
`model.save`, `provider.delete` and `settings.update` (with before and after values). Audit
rows hold ids and counts, never resume content.

### Mail

[`integrations/mail/mailer.ts`](../../apps/api/src/integrations/mail/mailer.ts) sends inline
(not through a queue) in one of three modes: `outbox` (files under `data/outbox`), `smtp`
(nodemailer) and `ses` (SES v2). Sending never throws into the caller.

## 7. Background jobs and queues

[`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts) holds the queue names
(`maintenance`, `resume-ai`), the typed job payloads, the retry policy and `enqueue`.

| Job | Queue | Payload | Retry policy |
| --- | --- | --- | --- |
| `resume-ai.run` | `resume-ai` | `{ resumeId, userId, component }` (ids only) | 3 attempts, exponential backoff from 10 s |
| `maintenance.lift-suspensions` | `maintenance` | `{}` | 5 attempts, from 5 s |
| `maintenance.purge-accounts` | `maintenance` | `{}` | 5 attempts, from 5 s |

`JOBS_MODE=queue` uses BullMQ on Redis. `JOBS_MODE=inline` runs the handler in-process right
after the commit, and the pipeline loops its own attempts; the integration tests use it, and
the production config guard flags it. The worker
([`worker.ts`](../../apps/api/src/worker.ts)) starts one BullMQ `Worker` per queue with
concurrency 4, registers repeatable schedules keyed by job name (`jobId: name`) so several
worker tasks leave exactly one schedule, and shuts down by closing the workers, the queues,
Redis and the pool. The API process also calls `registerAllJobs()` so inline mode works.

Completed jobs are kept (last 1000) and failed jobs (last 5000) for inspection.

## 8. Storage

[`integrations/storage.ts`](../../apps/api/src/integrations/storage.ts) has one interface and
two backends: S3 (private bucket, SSE-KMS, Floci locally) and local disk under `DATA_DIR`
(development). The resume flow uses only `put`, `get` and `delete`: uploads go through the API
and are written by the API ([ADR 0007](adr/0007-uploads-through-the-api-only.md)). Keys are
built by the server (`resumes/<user>/<resume>/original.<ext>`) from ids and a sniffed
extension; a client never supplies one. The local backend refuses a key that resolves outside
its directory. The interface also carries presigned-URL helpers (`presignPut`,
`signedGetUrl`) and `GET /api/files/local/:token`, which the resume code does not call; see
[security.md](security.md#known-gaps).

## 9. The AI and rendering seams

The resume services reach two things only through
[`services/resume/deps.ts`](../../apps/api/src/services/resume/deps.ts): `aiTasks()` and
`resumeRendererDep()`. Production wires the real implementations; tests call
`setResumeDeps` to inject fakes so no model or browser is touched. The contracts are
[`ai-tasks.ts`](../../apps/api/src/services/resume/ai-tasks.ts) and
[`renderer.ts`](../../apps/api/src/services/resume/renderer.ts). The AI side is in
[ai-engine.md](ai-engine.md), the rendering side in
[rendering-and-templates.md](rendering-and-templates.md).

## 10. The web app

`apps/web` is Next.js 15 (App Router, React 19, TanStack Query v5, Tailwind) built as a
standalone server.

| Area | Where |
| --- | --- |
| Route groups | `app/(auth)` (login, signup, verify, forgot and reset password, goodbye), `app/(app)` (home, `resumes`, `resumes/new`, `resumes/[id]`, `builder`, `samples`, `settings`), `app/(admin)/admin` (overview, users, quotas, models, settings, audit) |
| Runtime config | `app/env.js/route.ts` renders `/env.js` from the container's environment at request time, so one image fits every environment ([`lib/runtime-env.ts`](../../apps/web/src/lib/runtime-env.ts)) |
| CSP | [`middleware.ts`](../../apps/web/src/middleware.ts) builds a per-request nonce policy; see [security.md](security.md#7-headers-and-csp) |
| Session | [`lib/session.ts`](../../apps/web/src/lib/session.ts) keeps the access token in module memory only; a reload re-establishes it from the refresh cookie. [`lib/api.ts`](../../apps/web/src/lib/api.ts) builds the client from `@open-resume/api-client` with single-flight refresh and a cross-tab lock |
| Guards | `RequireAuth` redirects signed-out visitors to `/login?next=...`; `role="admin"` shows a forbidden page to non-admins (the API enforces it regardless) |
| Server state | TanStack Query; keys in [`lib/query-keys.ts`](../../apps/web/src/lib/query-keys.ts); resume status polling in [`lib/resume/polling.ts`](../../apps/web/src/lib/resume/polling.ts) |
| Preview | [`components/resume/preview-frame.tsx`](../../apps/web/src/components/resume/preview-frame.tsx): an iframe with `sandbox=""` and `srcDoc`, scaled to fit; HTML from [`lib/resume/use-preview.ts`](../../apps/web/src/lib/resume/use-preview.ts), debounced 450 ms while typing |
| Resume screens | [`components/resume/`](../../apps/web/src/components/resume/upload-view.tsx): upload, list, the report (analysis, improved, cover letter, tailor, interview, roadmap, projects), the template chooser, builder (chat panel, section editor, drafts drawer), samples |
| Links from resume data | [`lib/resume/safe-href.ts`](../../apps/web/src/lib/resume/safe-href.ts) allows only `http`, `https`, `mailto` and `tel`; anything else renders as text |

## 11. Packages

| Package | Notes |
| --- | --- |
| `@open-resume/types` | No runtime dependencies and no DOM or Node API, so a React Native app can vendor it. Enums mirror the migrations; `ResumeDocument`, `ComponentKind`, `ResumeStatus`, `Usage`, `AppSettings` and friends |
| `@open-resume/api-client` | `HttpClient` (refresh on `REFRESHABLE_CODES`, cross-tab lock, `ready` gate), endpoint groups (`core`, `resume`, `admin`), `postForm` upload with progress, `buildQuery`, keyset pagination helpers |
| `@open-resume/ui` | Radix-based components, `cn`, avatar helpers, design tokens (`tokens.css`, a Tailwind preset) |
| `@open-resume/samples` | Synthetic resumes generated by a seeded script; emails use `example.com`, phones are in a reserved fictional range |

## 12. Tests

Unit tests sit beside each package (`apps/api/test/unit`, `packages/*/test`,
`apps/web/test`). The API integration suite (`apps/api/test/integration`) runs against real
Postgres and Redis with `JOBS_MODE=inline` and the stubs started in-process;
[`scripts/test-matrix.sh`](../../scripts/test-matrix.sh) repeats it for `STORAGE` (local, s3)
by `MAIL_MODE` (outbox, smtp, ses), six runs on Floci. `e2e/` holds Playwright tests.
