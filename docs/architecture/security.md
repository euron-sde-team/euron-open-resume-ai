# Security architecture

The controls Euron Open Resume AI relies on, where each lives in the code, and what it does
not cover. The STRIDE analysis that ties threats to these controls is
[threat-model.md](threat-model.md). How to report a vulnerability: [SECURITY.md](../../SECURITY.md).
Paths are relative to the repository root.

A resume is personal data: contact details, employment history, sometimes a photo. The design
goal is that one user can never read another's resume, that nothing in a resume can run code
or reach the network, and that the operator holds the minimum of what a person wrote.

## 1. Authentication

| Control | Where | Detail |
| --- | --- | --- |
| Password hashing | [`security/passwords.ts`](../../apps/api/src/security/passwords.ts) | bcrypt (`bcryptjs`), cost `BCRYPT_ROUNDS` (default 12; below 12 is refused in production) |
| Password policy | same | 10 to 128 characters, not one repeated character, not containing the email local part or the username (`WEAK_PASSWORD`) |
| Sign-in throttling | [`services/auth.service.ts`](../../apps/api/src/services/auth.service.ts) | 5 failures per account and IP per 15 minutes and 50 per account per hour (Redis budgets). Once spent, every attempt is `429` whether the password is right or not. Unknown logins are counted under their own name and burn a bcrypt compare, so timing and answers do not reveal which accounts exist. Failed sign-ins are throttled, not locked, so nobody can lock another person out |
| Generic answers | same | `INVALID_CREDENTIALS` for an unknown login and a wrong password alike; resend-verification and forgot-password always answer the same |
| Email verification | same | On by default (`REQUIRE_EMAIL_VERIFICATION`); 24 h single-use links stored as SHA-256 hashes. A `PENDING_VERIFICATION` account cannot sign in |
| Password reset | same | 1 h single-use links stored as hashes; a reset revokes every session and bumps `token_version` |
| Two-factor | [`security/totp.ts`](../../apps/api/src/security/totp.ts) | TOTP (RFC 6238, SHA-1, 6 digits, 30 s). The secret is AES-256-GCM encrypted with a key derived by HKDF from `TOTP_ENCRYPTION_KEY`, with the user id as associated data (a ciphertext copied onto another account does not decrypt). Each code works once (`totp_last_step`). Ten single-use recovery codes are stored as HMACs keyed from the same secret and salted with the user id. Disabling needs the password and a code |
| Registration control | [`settings.service.ts`](../../apps/api/src/services/settings.service.ts) | `OPEN`, `INVITE_ONLY` (allowed email domains and their subdomains), `CLOSED` |
| Bootstrap admin | [`admin-bootstrap.service.ts`](../../apps/api/src/services/admin-bootstrap.service.ts) | `admin:create` promotes an existing account without touching its password, or creates one and emails a set-password link. It never prints a password unless `--print-password` is given (ECS stdout goes to CloudWatch) |

## 2. Sessions, cookies and CSRF

- **Access token.** HS256 JWT (`JWT_SECRET`), 15 minutes, audience `open-resume`, issuer
  `open-resume-api`, carrying `sub` and `ver`. The web app keeps it in module memory only,
  never `localStorage` or `sessionStorage`
  ([`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts)), so an injected script
  cannot lift a long-lived credential.
- **Refresh token.** 32 random bytes, 30 days, in the `resume_refresh` cookie (`httpOnly`,
  `SameSite=Lax`, `Path=/api/auth`, `Secure` when the app URL is https). Only its SHA-256 is
  stored. A reload re-establishes the session from the cookie.
- **Rotation and reuse detection.** Every refresh rotates within a `family_id`. A rotated
  token presented 10 s or more later revokes the whole family and audits
  `session.reuse_detected`; presenting a token within 10 s is treated as a tab race.
- **Every request reloads the user.** A `token_version` mismatch (sign out everywhere,
  password change or reset, ban, erase, role demotion) invalidates outstanding access tokens
  immediately, not at expiry.
- **Native token mode.** With `X-Client: native` the refresh token travels in the body and no
  cookie is set; the same rotation code path applies.
- **CSRF.** The only cookie-authenticated endpoints are `/api/auth/refresh` and
  `/api/auth/logout`. Everything else uses a bearer token in a header, which a cross-site form
  cannot set. The cookie endpoints are protected by `SameSite=Lax`, the `Path=/api/auth`
  scope, CORS (credentials only for `CORS_ORIGINS`) and an explicit check that refuses any
  non-GET request with a foreign `Origin` (`403 CORS_ORIGIN_DENIED`,
  [`app.ts`](../../apps/api/src/app.ts)).
- **Sessions are visible.** `GET /api/users/me/sessions` lists them with user agent and IP;
  any can be revoked.

## 3. Authorisation and ownership

There are two roles, `USER` and `ADMIN`, and four account states that matter
(`ACTIVE`, `SUSPENDED`, `BANNED`, `DEACTIVATED`; `PENDING_VERIFICATION` cannot sign in).

| Rule | Mechanism |
| --- | --- |
| Authenticated routes | `authenticate` on every router except `meta`, sign-up and sign-in endpoints |
| Ownership | Every resume, component and draft read or write filters on `user_id`: `resumeRepo.findOwned(id, userId)`, `draftRepo.findOwned`. Another user's id is indistinguishable from a missing one (404). Components are reached only through an owned resume; the worker also loads the resume with `findOwned(resumeId, userId)` |
| Writes need an active account | `requireActive` throws `403 ACCOUNT_RESTRICTED` for a suspended user in the resume and draft services. A suspended user can still read |
| Admin | `requireAdmin` is the first line of every admin service function: `ADMIN` role and `ACTIVE` status, else `403 FORBIDDEN_ADMIN` |
| Admin sees no content | No admin endpoint returns a resume, an analysis or a file. Admins see accounts, usage counts and configuration |
| Guard rails | `LAST_ADMIN` (cannot delete or demote the last active admin), `SELF_ACTION` (no suspending or banning yourself), `TARGET_PROTECTED` (demote an admin before suspending or banning them) |
| Client-side guards are cosmetic | `RequireAuth role="admin"` hides the admin UI from non-admins, but the API enforces every rule independently |
| Storage keys | Built by the server from ids and a sniffed extension; no client-supplied key or path is ever used |

## 4. Upload handling

[`middleware/multipart.ts`](../../apps/api/src/middleware/multipart.ts),
[`services/resume/extract.ts`](../../apps/api/src/services/resume/extract.ts).

- **In memory, bounded.** One file, read into memory, cut at the user's limit (at most 10 MB;
  the request is then `413 FILE_TOO_LARGE`), at most 12 fields. Nothing is written to disk
  by the multipart reader.
- **The client's file name is cleaned** to a plain base name (no path separators, no control
  characters, at most 120 characters) and used only as a label and a download name, never as
  a path.
- **Type from the bytes.** `%PDF-` in the first 1 KB is a PDF; a zip whose central directory
  contains `word/document.xml` is a DOCX; UTF-8 text with no NUL in the first 8 KB and a
  `.txt`, `.md` or `.markdown` name is text. The client's content type is ignored. Anything
  else is `415 UNSUPPORTED_FILE`.
- **Refuse before charging.** The text is extracted once before any run is charged; a scan or
  an image-only file (fewer than 40 characters) is `422 NO_TEXT`.
- **DOCX bomb guard.** The central directory's declared uncompressed size is summed, and a
  document declaring more than 60 MB is refused before it is opened.
- **Local only.** Extraction is `unpdf` for PDFs and `mammoth` for DOCX, in the API process.
  No OCR and no network.
- **Stored under a server-built key** (`resumes/<user>/<resume>/original.<ext>`), in a
  private bucket with SSE-KMS. The stored `Content-Type` comes from the sniffed type, not the
  client's. The original is served back only through the owner-scoped download endpoint,
  with `attachment` and `no-store`.
- **Deleted with the resume** and with the account.

## 5. Injection and output defences

### XSS

| Surface | Defence |
| --- | --- |
| The web app | React escapes by default. No resume or model text is rendered as HTML. A per-request CSP with a nonce is the backstop ([section 7](#7-headers-and-csp)) |
| The resume preview | The HTML comes from the server and is shown in an iframe with an empty `sandbox` and `srcdoc`: no scripts, no forms, no same-origin access. The document carries its own CSP (`default-src 'none'`) |
| The templates | 13 EJS templates, all output through the escaping `<%=` (no `<%-`); links through `safeHref` |
| Links in resume data | `cleanUrl` / `safeHref` allow only `http`, `https`, `mailto` and `tel`; control characters and whitespace are rejected (they are how scheme filters get bypassed); everything else becomes `#`. The web app has the same rule for links in the report |
| Images | Only `data:image/(png\|jpeg\|gif);base64,...`, size-capped; the DOCX builder also checks the magic bytes |
| Downloads | `Content-Disposition: attachment`, `no-store`, correct content type |
| Local file route | `nosniff`, `default-src 'none'; sandbox` |

### SSRF

The API makes outbound requests to exactly two kinds of destination: model providers and
mail. **No user-supplied URL is ever fetched**: links in a resume are rendered as text or
`href`, never requested, and the PDF engine blocks every network request. The one
server-side fetch to an operator-chosen address is the provider `base_url`, which only an
admin can set; see gap 5 in [Known gaps](#known-gaps).

### Prompt injection

Resume text, job descriptions, company names and chat messages reach a model only inside
`<untrusted_*>` blocks, with any look-alike tag removed, under a system prompt that treats
them as data; the answer must match a zod schema, so a hijacked answer in the wrong shape is
rejected; and the model has no tools, no network and no access to anyone's data
([ai-engine.md](ai-engine.md#5-prompt-hardening)). A hostile document can influence only its
own owner's resume.

### Zip, PDF and parser risks

PDF and DOCX parsing runs in-process on untrusted input. The mitigations are the byte
sniffing, the size cap, the DOCX declared-size guard and the bounded text length. See the
gap below.

## 6. Rate limits

Per-route limits are in [LLD.md](LLD.md#5-rate-limits). In short: Redis-backed budgets shared
by every API task, keyed by user (or IP when signed out), with an in-memory insurance limiter
during a Redis outage. Auth endpoints are 10 per minute per IP; mail-sending endpoints 5 per
hour per IP; uploads 20 per hour; AI retries and on-demand generations 30 per hour; downloads
40 per minute; builder chat 20 per minute; PDF export 20 per minute. Quotas are a separate
monthly budget ([quotas.md](quotas.md)).

## 7. Headers and CSP

**API** ([`app.ts`](../../apps/api/src/app.ts)): Helmet with `default-src 'none'`,
`frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: cross-origin`, no `X-Powered-By`.
Resume HTML routes add the document policy
(`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`), and the
stored-resume route also `base-uri 'none'`, `form-action 'none'`, `sandbox` and a
`frame-ancestors` list of `'self'` plus the allowed origins. Downloads and detail reads send
`Cache-Control: no-store`.

**Web app** ([`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts),
[`next.config.ts`](../../apps/web/next.config.ts)):

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Per request, with a nonce: `default-src 'self'`; `script-src 'self' 'nonce-...' 'strict-dynamic'` (plus `'unsafe-eval'` only in development); `style-src 'self' 'unsafe-inline'` (Radix positions popovers with inline styles); `img-src 'self' data: blob:` plus media origins; `connect-src 'self'` plus media origins; `frame-src 'self' blob:`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=(), payment=(), fullscreen=(self)` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

On AWS, TLS ends at the ALB. With CloudFront on, a secret `X-Origin-Verify` header must
accompany every origin request or the listener answers 403, and WAF (AWS managed common and
known-bad-inputs rule sets plus a per-IP rate rule) can be attached.

## 8. Secrets and the configuration guard

All environment variables are declared once in
[`core/config.ts`](../../apps/api/src/core/config.ts) and validated with zod.

- Outside production the security-critical values fall back to development defaults so
  `make up` works with no setup. **In production `assertProductionConfig` throws at boot**
  while any of these hold: `JWT_SECRET` or `REFRESH_SECRET` is the committed default or
  shorter than 32 characters, or they are equal; `TOTP_ENCRYPTION_KEY` is the default (derived
  from a public constant); `CORS_ORIGINS` is empty; `APP_WEB_URL` points at localhost;
  `STORAGE=local` or `STORAGE=s3` without `S3_BUCKET`; `MAIL_MODE=outbox`, or no `MAIL_FROM`;
  `JOBS_MODE=inline`; `BCRYPT_ROUNDS` below 12.
- **Provider keys** (`PROVIDER_KEYS` and the single-key shortcuts) are read from the
  environment on every call and are never stored in the database, returned by an endpoint or
  logged. The admin API reports only `keyConfigured`. A provider error body is logged
  truncated with key-shaped strings masked and is never shown to a user.
- **On AWS** the secrets come from Secrets Manager, injected by ECS; the database password is
  read from its secret per connection, so a rotation needs no redeploy. Values start as
  `set-me` placeholders, which the API treats as not configured.
- **The TOTP key** encrypts secrets at rest and keys the recovery-code HMAC; rotating it
  invalidates enrolled authenticators.
- **Local file links** (development only) are HMAC-signed with a key derived from
  `REFRESH_SECRET`.
- The repository is scanned for committed credentials, account ids, real emails and IPs by
  `make sanitize`.

## 9. Privacy

| Question | Answer |
| --- | --- |
| What is stored | The account, the resume (original file, parsed document, rewrite, analysis, cover letter, generated components) and drafts. Usage rows hold counts and kinds |
| What is sent to a model | Only if an admin has configured a provider: the extracted resume text (capped), the job description (capped) and the company name, inside untrusted blocks. With no provider, nothing leaves the deployment |
| What is logged | Task name, user id, whether it was offline, token counts, ids and error classes. The logger redacts the field names `password`, `token`, `refreshToken`, `code`, `totp`, `secret`, `apiKey`, `authorization`, `cookie`, `content`, `prompt`, `messages`, `input`, `document`, `jd`, `text`, `original`, `improved`, `coverLetter`, `cover_letter`, `photoDataUrl` and `buffer` at up to three levels of nesting. Resume text, job descriptions and prompts never reach a log line |
| What is in the audit log | Actor, action, entity, IP and small payloads (ids, counts, setting values). Never resume content |
| What is in queue jobs | Ids only |
| What an admin can see | Accounts, usage counts, configuration. No resumes, no files |
| Data export | `GET /api/users/me/export` (3 per day) streams one JSON document with the account, preferences, every resume (with its generated components, without the storage key) and drafts |
| Account deletion | `DELETE /api/users/me` (password and, if enabled, a second factor) signs out everywhere and starts a 14-day grace period; signing in again cancels it. After it, `maintenance.purge-accounts` anonymises the account and deletes resumes, drafts and stored files. An admin can erase at once. The `users` row stays (audit and usage history point at it) with a placeholder email and name |
| Retention | Resumes live until the user deletes them. The audit log has no automatic expiry. Log retention is a Terraform variable (14 days dev, 365 days prod) |
| Backups | RDS automated backups (3 days dev, 14 days prod) hold deleted data until they expire |

## 10. Supply chain and build

Dependencies are pinned in the lockfile and the images install with a frozen lockfile. The
container runs as the non-root `node` user with tini as PID 1. Terraform has `make` targets for
formatting, validation, `tflint` and `checkov` policy scans. The API image carries Chromium, which is
the largest attack surface in it ([ADR 0008](adr/0008-chromium-with-no-network-for-pdfs.md)).

## Known gaps

Verified against the code. Each is a limitation to plan around, not a hidden feature.

| # | Gap | Where | Impact | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Account enumeration at sign-up.** Sign-up answers `409 EMAIL_TAKEN` and `USERNAME_TAKEN` | [`auth.service.ts`](../../apps/api/src/services/auth.service.ts) `signup` | Anyone can learn whether an email or username is registered. Sign-in, resend-verification and forgot-password are uniform | Limited by the 10 per minute per IP `auth` limiter. A uniform "check your inbox" response would close it at the cost of the sign-up UX |
| 2 | **Builder render and export routes do not check account status.** `POST /api/builder/render` and `/export` call `authenticate` only, not `requireActive` | [`builder.controller.ts`](../../apps/api/src/controllers/builder.controller.ts) | A suspended user (documented as read-only) can still render and export a document they supply. Chat and import, which spend runs, do require an active account. Banned and deactivated accounts are refused by `authenticate` | One-line fix: `requireActive(actorOf(req))` |
| 3 | **A crashed worker's job is skipped, then waits for the reaper.** A redelivered job finds a claim younger than 10 minutes and exits as `skipped` | [`resume-component.repository.ts`](../../apps/api/src/repositories/resume-component.repository.ts) `claim`; [resume-pipeline.md](resume-pipeline.md#6-stale-work) | The component stays `processing` until the reaper fails and refunds it (30 minutes, and only when someone reads that resume) or the user retries | No scheduled sweep exists |
| 4 | **Resolved.** A missing or busy Chromium is `503 PDF_UNAVAILABLE` on both the builder export and the saved-resume download | [`resume.service.ts`](../../apps/api/src/services/resume/resume.service.ts) | None | None |
| 5 | **Admin-set `base_url` can point anywhere, and carries the provider's key.** The API sends the provider key to whatever `base_url` the admin saved, with no address filter | [`admin.service.ts`](../../apps/api/src/services/admin.service.ts) `saveProvider`, [`integrations/llm/`](../../apps/api/src/integrations/llm/index.ts) | An admin (a trusted role) or a stolen admin session can aim the server at an internal address (including a cloud metadata endpoint) or exfiltrate a configured key to a host they control. The response body is not returned to the admin, which limits but does not remove the risk | Admin only; two-factor on admins and the audit log are the mitigations. An allow-list or a private-range filter would close it |
| 6 | **In-process parsing of untrusted PDFs and DOCX.** `unpdf` (pdf.js) and `mammoth` run in the API process with no time limit; the DOCX size guard reads declared sizes from the central directory | [`extract.ts`](../../apps/api/src/services/resume/extract.ts) | A crafted file can burn CPU or memory in an API task. The 10 MB cap and the per-user upload limit bound the volume | Moving extraction to the worker with a timeout, or into a subprocess, would isolate it. Extraction currently runs in the API (pre-check) and again in the worker |
| 7 | **The builder import route reads up to 64 MB of an oversized request before answering 413.** It buffers up to the cap, then reads and discards up to 64 MB more so the client sees the 413 and not a broken pipe | [`builder-ai.controller.ts`](../../apps/api/src/controllers/builder-ai.controller.ts) `readUpload` | A larger memory and bandwidth cost per oversized request than the resume upload route, which stops at the limit. Rate-limited at 6 per minute | |
| 8 | **Chromium's sandbox is off in the shipped images** (`CHROMIUM_NO_SANDBOX=1`) | [`infra/docker/api.Dockerfile`](../../infra/docker/api.Dockerfile), Terraform task environment | A Chromium escape would not be contained by its own sandbox. JavaScript is off, only `data:` and `about:` load, and the container is non-root with a read-only root filesystem on Fargate | Set `CHROMIUM_NO_SANDBOX` unset on a host that can grant the sandbox capabilities |
| 9 | **The profile photo is not rendered in the HTML templates (preview and PDF).** It is stored, validated and used in the DOCX only | [`render/`](../../apps/api/src/services/resume/render/mapper.ts), `apps/api/src/templates` | Not a vulnerability. A user who adds a photo sees it in DOCX and not in the preview or the PDF | |
| 10 | **`systemPromptAddendum` is a setting with no effect.** The admin settings page says it is added to every AI request; no prompt builder reads it | [`settings.service.ts`](../../apps/api/src/services/settings.service.ts), [`admin/pages/settings.tsx`](../../apps/web/src/components/admin/pages/settings.tsx) | Misleading. An admin may believe a policy is applied that is not | Wire it into the prompts or remove the field |
| 11 | **Two quota error codes** for one condition: `QUOTA_EXHAUSTED` (resume endpoints) and `QUOTA_EXCEEDED` (builder endpoints) | [`resume.service.ts`](../../apps/api/src/services/resume/resume.service.ts), [`quota.service.ts`](../../apps/api/src/services/quota.service.ts) | A client must handle both. The web app does | |
| 12 | **Duplicate normalisers and extractors** with different caps (photo 1 MB vs 4 MB, experience 30 vs 25) and two text-extraction modules | [`resume/document.ts`](../../apps/api/src/services/resume/document.ts), [`ai/document.ts`](../../apps/api/src/services/resume/ai/document.ts), [`ai/extract-text.ts`](../../apps/api/src/services/resume/ai/extract-text.ts) | Behaviour can differ between the builder import and a resume upload for the same file. The import route also sniffs more loosely (a `.docx` name for any zip) and checks no declared size | Merge into one |
| 13 | **Unused storage code.** `presignPut`, `signedGetUrl`, `head`, `readStart` and `GET /api/files/local/:token` are not called by the resume flow | [`integrations/storage.ts`](../../apps/api/src/integrations/storage.ts), [`routes/storage.routes.ts`](../../apps/api/src/routes/storage.routes.ts) | A small amount of dead attack surface (the route is disabled unless `STORAGE=local`) | Remove, or keep for a future direct-upload design |
| 14 | **Provider error bodies are logged (600 characters, key patterns masked).** A provider could echo part of a prompt in an error | [`integrations/http.ts`](../../apps/api/src/integrations/http.ts) `failFromResponse` | Resume text could reach a log line in that case | Log only status and failure class |
| 15 | **Refunds target the current month.** A charge made just before midnight UTC and refunded just after decrements the new month's row | [`quota.service.ts`](../../apps/api/src/services/quota.service.ts) `refundRuns` | A few runs of drift at month boundaries | |
| 16 | **No automatic audit-log expiry** and no export of the audit log | `audit_log` | Operators manage retention themselves | |
| 17 | **Stale comments describe behaviour that is not there.** The Dockerfile, the compose file and the Terraform module header say the worker renders PDFs and extracts text; the API renders PDFs. The migration comment mentions pinning a model per task, which is not implemented | [`api.Dockerfile`](../../infra/docker/api.Dockerfile), [`compose.yaml`](../../deploy/compose/compose.yaml), [`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf), [`0001_init.sql`](../../db/migrations/0001_init.sql) | Misleads an operator sizing tasks | |
