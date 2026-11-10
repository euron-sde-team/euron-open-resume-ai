# Threat model

A STRIDE analysis of Euron Open Resume AI as deployed by the Terraform in `infra/terraform`
(an aws-prod shaped environment with CloudFront and WAF) and the defaults in the code. Each
row names the threat, the control that exists today and what remains. Controls are described
in [security.md](security.md). **Accepted** means a design choice; **open** means a known gap
worth fixing (numbered as in [Known gaps](security.md#known-gaps)); the rating (low, medium,
high) is the impact on a typical deployment if exploited. Paths are relative to the repository
root.

## Common weaknesses of a resume service, and what closes them

Resume products collect personal data, parse untrusted files and render untrusted text. These
are the classic weaknesses of that shape, and the specific control that closes each here:

| Weakness | Control in this design | Where |
| --- | --- | --- |
| Files that reach storage before they are validated, under a key the client chose | Uploads go through the API only. The API reads the bytes, decides the type from them, refuses scans, charges the run, and writes the object itself under a server-built key. The client never holds a storage credential or a URL it can alter | [`middleware/multipart.ts`](../../apps/api/src/middleware/multipart.ts), [`services/resume/resume.service.ts`](../../apps/api/src/services/resume/resume.service.ts), [ADR 0007](adr/0007-uploads-through-the-api-only.md) |
| A resume readable by anyone who knows its id | Every read is scoped to `user_id`; a foreign id is a 404 | [`repositories/resume.repository.ts`](../../apps/api/src/repositories/resume.repository.ts) `findOwned` |
| One status column per AI result, so a failed roadmap marks the whole resume failed and a retry re-runs everything | One `resume_components` row per unit of work with its own state; the resume status derives from the analysis and rewrite rows only | [ADR 0006](adr/0006-component-table-pipeline.md) |
| PDF rendering that loads remote resources named in the resume | A locked-down Chromium: JavaScript off, every request except `data:` and `about:` aborted | [`render/pdf.ts`](../../apps/api/src/services/resume/render/pdf.ts), [ADR 0008](adr/0008-chromium-with-no-network-for-pdfs.md) |
| Resume HTML previewed in the application's own origin | Server-rendered HTML in an iframe with an empty `sandbox` and `srcdoc`, under its own CSP | [`preview-frame.tsx`](../../apps/web/src/components/resume/preview-frame.tsx) |
| Model output and resume text rendered without filtering links and images | One link filter (`cleanUrl`, `safeHref`), data-URL images only, escaped templates | [`render/safe.ts`](../../apps/api/src/services/resume/render/safe.ts) |
| Resume text and job descriptions in prompts treated as instructions | Untrusted blocks, a data-only rule in the system prompt, schema-validated output | [`ai/prompts.ts`](../../apps/api/src/services/resume/ai/prompts.ts) |
| No limits on AI use | Monthly run quotas charged atomically, rate limits per route | [`quota.service.ts`](../../apps/api/src/services/quota.service.ts), [`rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts) |
| Resume text in logs and usage rows | Counts and ids only; the logger redacts content field names | [`core/logger.ts`](../../apps/api/src/core/logger.ts) |
| Plaintext provider keys in the database | Keys only in the environment or Secrets Manager; `keyConfigured` is all an admin sees | [`core/config.ts`](../../apps/api/src/core/config.ts) |
| Raw provider errors shown to users | Failures mapped to stable codes and fixed messages | [`integrations/http.ts`](../../apps/api/src/integrations/http.ts) |

## Scope and trust boundaries

| Boundary | Crossing |
| --- | --- |
| TB1 | Internet to the edge (CloudFront, WAF, ALB): every request is untrusted |
| TB2 | Edge to tasks: TLS ends at the ALB, tasks are in private subnets, the CDN's secret origin header is required |
| TB3 | Application to its stores (RDS, ElastiCache, S3, Secrets Manager, KMS): IAM task roles, security groups, TLS |
| TB4 | Application to model providers and mail: outbound HTTPS with keys from the environment |
| TB5 | Application to Chromium: HTML that embeds untrusted text and URLs goes in, a PDF comes out |
| TB6 | Model output back into the application: parsed JSON, untrusted |
| TB7 | Uploaded bytes into the parsers (`unpdf`, `mammoth`): untrusted files |

Inside the application:

| Principal | Holds |
| --- | --- |
| Visitor | `GET /api/meta`, sign-up and sign-in |
| User | Their own resumes, drafts, preferences, usage, sessions |
| Admin | `/admin`: accounts, tiers, providers and models, settings, audit, stats; not resumes |
| A model | Nothing: no tools, no network, no data beyond one task's untrusted blocks |
| Authors of resume content | Whatever text, links and images a document puts in front of a model, a parser or a renderer |

## Assets

| Rank | Asset | Why it matters |
| --- | --- | --- |
| 1 | Resume content (contact details, history, photo, job descriptions) | Personal data that people give to a job application |
| 2 | Credentials and sessions, the JWT, refresh and TOTP keys | Account takeover, including of admins |
| 3 | Provider keys and the operator's provider spend | Direct financial loss and quota exhaustion |
| 4 | The internal network reachable from the API tasks | SSRF to metadata services and internal APIs |
| 5 | Admin powers and the audit trail | Abuse or loss of accountability |
| 6 | Availability of the API, the worker, Redis and Chromium | A product that cannot analyse or export |

## STRIDE by surface

### Authentication and sessions

| | Threat | Control | Residual | Rating |
| --- | --- | --- | --- | --- |
| S | Credential stuffing or guessing | bcrypt 12, 10 to 128 character policy, per-account and per-IP failure budgets with a uniform 429, 10 per minute per IP on auth routes, optional TOTP | Distributed attempts are bounded at 50 per account per hour. No breached-password check. **Accepted** | medium |
| S | Account enumeration | Uniform sign-in, forgot-password and resend answers; dummy bcrypt compare for unknown accounts | Sign-up reveals an existing email or username (gap 1). **Open** | low |
| S | Stolen refresh token | httpOnly `SameSite=Lax` cookie scoped to `/api/auth`, hashed at rest, rotation with reuse detection that revokes the family | A token used within 10 s of rotation is treated as a race. **Accepted** | medium |
| S | Stolen access token | 15 minutes, in memory only, `token_version` checked against the database on every request | A thief has up to 15 minutes unless the user signs out everywhere. **Accepted** | medium |
| T | Forged JWT | HS256 with a secret of at least 32 characters (refused at boot in production if default), audience and issuer checked | The secret is shared by all API tasks. **Accepted** | high |
| R | A user denies an action | Audit rows for sign-up, sign-in, role and tier changes, resume create, tailor, delete, export, deletion, session reuse | No audit of resume views or downloads. **Accepted** | low |
| I | TOTP secret or recovery code leak from the database | AES-256-GCM with the user id as AAD; recovery codes stored as HMACs | A leak of `TOTP_ENCRYPTION_KEY` plus a database dump exposes secrets. **Accepted** | medium |
| D | Mail flooding through forgot-password or resend | 5 per hour per IP; answers do not depend on the account | Per-IP only. **Accepted** | low |
| E | A user becomes admin | Role is set only by an admin or `admin:create`; `authenticate` reloads the role from the database; `LAST_ADMIN` and `SELF_ACTION` guards | None known | high |

### Resumes, uploads and storage

| | Threat | Control | Residual | Rating |
| --- | --- | --- | --- | --- |
| S | Uploading as someone else | Ownership comes from the access token; a user id is never taken from a request | None known | high |
| T | A client alters a storage key to overwrite or read another file | No client-supplied key exists; the server builds `resumes/<user>/<resume>/original.<ext>` | None known | high |
| T | A hostile file disguised by name or content type | The type is decided from the bytes; the stored type is the sniffed one; downloads are `attachment` with `no-store` | None known | medium |
| I | IDOR on resumes, components, drafts, downloads, renders | Every query filters on `user_id`; a foreign id is a 404; components are reached through an owned resume; the worker re-checks ownership | None known | high |
| I | Another user's resume through the export or the admin API | The export is scoped to the caller; no admin endpoint returns resume content | None known | high |
| I | Leaking a file through a long-lived URL | No public URLs; the original is served through an authenticated owner-scoped endpoint, `no-store` | The unused presigned-URL helpers (gap 13) are not routed. **Accepted** | low |
| D | Zip bomb, huge or crafted PDF or DOCX | 10 MB cap, bounded text, declared-size guard on DOCX | Parsers run in the API process with no timeout (gap 6). **Open** | medium |
| D | Filling storage with uploads | Per-user resume cap, per-user monthly run quota, 20 uploads per hour | Storage is not billed or capped per user beyond the resume count. **Accepted** | low |
| D | Many parallel uploads past a limit | Advisory locks around the slot re-check and the charge | None known | low |
| E | Path traversal through a file name | Names are cleaned to a base name and used only as a label; keys are built from ids; the local backend rejects a key that resolves outside its directory | None known | high |

### Rendering and the PDF engine

| | Threat | Control | Residual | Rating |
| --- | --- | --- | --- | --- |
| T | Script injection through resume fields | Escaped templates, link and image filters, the document's own CSP, an empty sandbox in the iframe, the web app's CSP | None known | high |
| I | A resume reaches the network from the PDF engine (SSRF, tracking pixels, font or stylesheet fetches) | JavaScript off, every request except `data:` and `about:` aborted, fonts and icons inlined | A Chromium vulnerability could bypass this (gap 8). **Accepted** | high |
| I | Reading local files through the renderer | `setContent` with no file or http origin; `file:` requests are aborted | None known | high |
| D | Exhausting memory with many PDF requests | 2 concurrent pages per process, a queue of 25, 40 downloads or 20 exports per minute, page timeouts, browser recycling after 100 pages | PDF load competes with API traffic in the same task. **Accepted** | medium |
| D | A missing or busy Chromium | 503 on builder export; the resume download returns 500 (gap 4) | **Open** | low |
| E | Chromium escape | Non-root container, read-only root filesystem on Fargate, no network from the page | The Chromium sandbox is off in the shipped image (gap 8). **Accepted** | high |

### AI layer

| | Threat | Control | Residual | Rating |
| --- | --- | --- | --- | --- |
| T | Prompt injection in a resume or job description (change the score, leak the rules, change the format) | Untrusted blocks with look-alike tags removed, a data-only system rule, schema-validated output, no tools, no network, owner fields restored after a rewrite | A hostile document can bias its own owner's results. **Accepted** | low |
| T | A model invents facts in a rewrite | Prompts forbid it; owner fields and missing sections come from the original. The offline engine never invents | A model can still reword a fact wrongly; the user reviews the result. **Accepted** | medium |
| I | Resume text sent to a third-party provider | Only if an admin configures one; inputs capped; the offline engine is the default | By design, a configured provider receives resume text. Operators should choose providers accordingly. **Accepted** | high |
| I | Provider keys leaking | Environment or Secrets Manager only; never in a row, DTO or log; provider bodies masked | An admin can aim a key at another host (gap 5). **Open** | high |
| I | Resume text in logs | Redaction by field name; task logs carry counts only | Provider error bodies are logged truncated (gap 14). **Open** | low |
| D | Burning the provider budget | Monthly runs, per-route rate limits, a 3-attempt cap, timeouts of 120 s and 180 s | Quotas count runs, not tokens (see [quotas.md](quotas.md)). **Accepted** | medium |
| D | A provider outage | Retry with backoff, then a failed component and a refund | There is no automatic fallback to another provider or to the offline engine. **Accepted** | medium |
| E | A model acting on the system | The model has no tools and no credentials; its output is data | None known | high |

### Pipeline and quotas

| | Threat | Control | Residual | Rating |
| --- | --- | --- | --- | --- |
| T | Double charge or double run from a double click or duplicate delivery | Conditional `UPDATE` claims, the `request` upsert, refunds for rejected duplicates | None known | medium |
| T | Charging without doing the work | Charge, store, insert in one flow with refunds on every failure path; enqueue after commit; stale work is failed and refunded | A crashed worker's work waits up to 30 minutes and a read to be refunded (gap 3). **Open** | medium |
| R | A dispute about a refund | `usage_monthly` has counts by kind; `resume_components.charged` shows what was taken; audit rows for creation | Refund events themselves are not audited. **Accepted** | low |
| D | Queue poisoning with oversized or malformed jobs | Payloads are ids validated by zod; content is read from the database | None known | low |
| D | One user monopolising the worker | Per-user rate limits and quotas; worker concurrency of 4 per queue | No per-user queue fairness. **Accepted** | low |
| E | Spending runs while suspended | `requireActive` on resume and draft writes | The builder chat and import routes do not check (gap 2). **Open** | low |

### Admin plane

| | Threat | Control | Residual | Rating |
| --- | --- | --- | --- | --- |
| S | A stolen admin session | Same session controls; optional TOTP; demotion revokes admin at once | Two-factor is not mandatory for admins. **Accepted** | high |
| T | An admin tampers with quotas or settings | Every mutation is audited in the same transaction, settings with before and after | An admin can edit the audit-adjacent data they own, but not the audit log. **Accepted** | medium |
| I | An admin reads user resumes | No endpoint returns resume content or files | An operator with database or bucket access can. That is an infrastructure control, not an application one. **Accepted** | high |
| D | An admin removes the last admin or default tier | `LAST_ADMIN`, `TIER_IS_DEFAULT`, `TIER_DEFAULT_REQUIRED` | None known | low |
| E | An admin triggers SSRF through a provider URL | `http(s)` required | No address filtering (gap 5). **Open** | medium |

### Web app

| | Threat | Control | Residual | Rating |
| --- | --- | --- | --- | --- |
| T | XSS | React escaping, no model or resume HTML in the app origin, a nonce CSP with `strict-dynamic` and `object-src 'none'` | `style-src 'unsafe-inline'`. **Accepted** | medium |
| T | CSRF on cookie endpoints | `SameSite=Lax`, path scope, origin check, CORS | None known | medium |
| I | A token in `localStorage` | The access token is in memory only | None known | medium |
| I | Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | None known | low |
| D | Stale deployments | Standalone Next build with runtime `/env.js` | None specific | low |

## Review checklist when adding a feature

1. Does a new table carry `user_id`, and does every query filter on it?
2. Does a new endpoint call `authenticate`, a rate limiter and `requireActive` for writes?
3. Does a new AI task wrap user text with `untrusted()` and validate with a zod schema?
4. Does a new output path (a new format, a new template) escape values and use `safeHref`?
5. Does a new run-consuming action charge before the work and refund on every failure path?
6. Does a new log line carry ids and counts only?
7. Does a new outbound request go to a fixed, operator-chosen destination?
