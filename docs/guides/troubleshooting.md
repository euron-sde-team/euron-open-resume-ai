# Troubleshooting

Symptoms, causes and fixes, grouped by area. Every error body carries a `requestId` (also
the `X-Request-Id` response header) that finds the API log line, and a stable `code` that
the web app switches on ([api.md](api.md#errors)).

## Local stack

| Symptom | Cause | Fix |
| --- | --- | --- |
| `port is already allocated` on `make up` | Another process uses 3630, 5106, 5552, 6489, 8106, 1106, 4657 or 5199 | Move it in `deploy/compose/.env`: `RESUME_WEB_PORT`, `RESUME_API_PORT`, `RESUME_PG_PORT`, `RESUME_REDIS_PORT`, `RESUME_MAILPIT_PORT`, `RESUME_SMTP_PORT`, `RESUME_FLOCI_PORT`, `RESUME_STUB_PORT` ([quickstart-local.md](quickstart-local.md#ports)) |
| `run make env first` | Compose started without the generated secrets | `make env` (or `make up`, which runs it) |
| The `terraform` or `migrate` one-shot fails | Emulator state and its Terraform state out of step, or a stale `.terraform` from running Terraform on the host | `make logs SERVICE=terraform` (or `migrate`); `make down && make up`; delete `infra/terraform/envs/local-floci/.terraform` |
| No email arrives | Compose sends every mail to Mailpit; a native run with `MAIL_MODE=outbox` writes files | http://localhost:8106; natively, look for `data/outbox/*.eml` under the API's working directory (`apps/api/data`) or set `MAIL_MODE=smtp SMTP_HOST=localhost SMTP_PORT=1106` |
| Sign-in says `EMAIL_NOT_VERIFIED` | `REQUIRE_EMAIL_VERIFICATION=true` (the default) | Open the link in Mailpit (or the `.eml`), request a new link (`POST /api/auth/resend-verification`, limited to 5 per hour per IP), or set `REQUIRE_EMAIL_VERIFICATION=false` in `.env` for local work and `make up` again |
| A change to `.env` has no effect | Compose reads `.env` when it creates containers | `make up` again |
| Uploads stay `queued` forever (native run) | No worker process, and `JOBS_MODE=queue` | `pnpm --filter @open-resume/api dev:worker`, or `JOBS_MODE=inline` for the API |
| `ECONNREFUSED` to 5552 or 6489 at API start | Postgres or Redis is not on the default port | Start them there, or set `DATABASE_URL` and `REDIS_URL` |
| `Invalid configuration:` at boot | A variable fails validation (the message lists each) | Fix the named variable ([configuration.md](configuration.md)) |
| `relation "..." does not exist` | Migrations not applied | `pnpm db:migrate` (compose runs the `migrate` one-shot) |
| `make demo` prints the logins but sign-in fails | The demo ran earlier with another password; the password is printed only when first seeded | `make down && make up && make demo`, or use the `RESUME_DEMO_PASSWORD` in `deploy/compose/.env` if the volumes are fresh |

## Uploads and analysis

| Symptom | Cause | Fix |
| --- | --- | --- |
| `415 UNSUPPORTED_FILE` | The file's real type is not PDF, DOCX, TXT or Markdown. The API sniffs the first bytes, so renaming a file does not help | Export the resume as PDF or DOCX; legacy `.doc` is not supported |
| `413 FILE_TOO_LARGE` | Over the member's tier limit (`maxUploadMb`, never above 10 MB) | Compress the file, or raise the member's limit in `/admin/users` or the tier in `/admin/quotas` (the cap is still 10 MB) |
| `422 NO_TEXT` ("looks like a scan or an image") | A scanned or image-only file: fewer than 40 characters of text. Extraction runs while the upload request is handled, before anything is charged or stored | Export a text-based PDF from the original editor, or upload a DOCX or TXT. No run is charged |
| `422 UNREADABLE_FILE` | Corrupt or password-protected PDF, or a DOCX that expands to more than 60 MB | Re-export the file |
| `422 EMPTY_DOCUMENT` | `POST /api/resumes/from-document` (the builder's **Analyse**) with a document that has no content | Add content in the builder first |
| `400 EXPECTED_MULTIPART`, `BAD_MULTIPART`, `FILE_REQUIRED`, `TOO_MANY_FILES` | The request is not `multipart/form-data` with exactly one `file` field | See the curl example in [api.md](api.md#upload-a-resume) |
| `409 RESUME_LIMIT` | The member already holds `maxResumes` resumes | Delete one, or raise the limit |
| `429 QUOTA_EXHAUSTED` / `QUOTA_EXCEEDED` | The month's runs are used (the code is `QUOTA_EXHAUSTED` from the resume routes and `QUOTA_EXCEEDED` from the builder; the web app treats both alike) | Wait for the reset (the first of the next UTC month), or raise the limit. `details` has `limit`, `used`, `resetsAt` |
| Everything says "Resume not found" for a resume you uploaded | You are signed in as a different account; another account's resume is a 404 by design | Sign in as the owner |
| A component shows **Failed** | The model failed three times, the file was unreadable, or it took more than 30 minutes | Read the message; press **Retry** (`POST /api/resumes/:id/retry`). A failed run is refunded |
| `409 NOTHING_TO_RETRY`, `NOT_FAILED` | No component of that resume has failed | Nothing to do |
| `409 ALREADY_RUNNING` | The same component is already queued or running | Wait; the page follows it |
| `409 NOT_READY` | A download or preview was asked for before the improved resume or cover letter exists | Wait for the analysis to finish |

## Jobs stuck

| Symptom | Cause | Fix |
| --- | --- | --- |
| A resume stays `queued` | No worker is running, or it cannot reach Redis | `make logs SERVICE=worker` (`worker started` should appear); AWS: check the worker service in ECS and the `worker-failed-jobs` alarm |
| A resume stays `processing` | The job's worker died after claiming it | Nothing to do: a claim older than 10 minutes is taken over, and a component `processing` for 30 minutes is failed and refunded the next time the resume is loaded |
| Jobs fail repeatedly | The model provider is down or rejecting calls | `provider call failed` and `model call failed` in the log; **Test** the model in `/admin/models` |
| Redis queue backed up | Worker too small for the load | Raise `worker_max_count`; see [operations.md](operations.md#scaling) |
| Jobs inspected by hand | | [operations.md](operations.md#inspecting-the-queues) |

## Models and providers

| Symptom | Cause | Fix |
| --- | --- | --- |
| Analysis works but reads like a template, scores are suspiciously stable | The offline engine is answering: no usable text model | `GET /api/admin/integrations` (or the Integrations panel in `/admin/settings`) says whether a model is configured. Add a key and make sure a model is enabled ([connect-real-providers.md](connect-real-providers.md)) |
| A key is set but the model is not used | The provider's **slug** differs from the key name in `PROVIDER_KEYS`, the provider or model is disabled, the API and worker were not restarted after the secret changed, or the catalogue cache (5 s) has not expired | Check `keyConfigured` in `/admin/models`; slugs are lowercase ids, not display names; roll both services |
| **Test** says "No key is configured for this provider on the server" | No key under that exact slug | Fix the slug or the key name; roll the services |
| **Test** says "The provider rejected the key" | Wrong, revoked or unfunded key (401 or 403) | Check the key at the provider |
| **Test** says "check the model id" | The provider answered 400: the `modelRef` is wrong for that provider | Edit the model; ids change often |
| `503 AI_UNAVAILABLE` from the builder; a component fails with "The AI service is not available right now" | Timeout (120 s, 90 s for chat), rate limit, 5xx or an unreachable host | Retry; check the provider status; use a faster model |
| `502 AI_BAD_OUTPUT` / "The AI returned an answer we could not use" | The model did not return valid JSON for the schema, twice | Use a stronger model; raise max output tokens (a cut-off answer is the usual cause) |
| "This resume is too long for the AI model" | Provider refused the size | The API caps resume text at 30,000 characters; set the model's real context window; shorten the resume |
| `400 STUB_IN_PRODUCTION` | Creating a `STUB` provider with `NODE_ENV=production` | Use a real provider |
| `400 BASE_URL_REQUIRED` / `BASE_URL_INVALID` | An `OPENAI_COMPATIBLE` provider needs an `http(s)` base URL | Fill it in |
| Ollama in Docker cannot be reached | `localhost` inside the API container is the container | Base URL `http://host.docker.internal:11434/v1` |

## Export and rendering

| Symptom | Cause | Fix |
| --- | --- | --- |
| Builder export or a saved-resume PDF download answers `503 PDF_UNAVAILABLE` ("PDF export is not available right now") | No Chromium found (message in the log: "No Chromium found"), or the render queue is full | Install Chromium and set `CHROMIUM_PATH`; in the image it is `/usr/bin/chromium`; check `PDF_CONCURRENCY` |
| `exec format error` in ECS | Image platform differs from `cpu_architecture` | `PLATFORM=linux/arm64 make aws-deploy` for `ARM64`, default for `X86_64` ([deploy-aws.md](deploy-aws.md#deploy)) |
| Chromium crashes or the task is OOM-killed on long resumes | Under 2 GB of memory, or a small `/dev/shm` in Docker (the default 64 MB) | Keep API and worker at 2048 MiB or more; compose sets `shm_size` |
| PDF shows boxes instead of letters | Missing fonts for that script | The image ships Liberation, Noto Core and Noto Color Emoji; a custom image needs them too |
| PDF differs from the in-app preview | A template relies on a font that is not bundled | Use only the bundled Lato and Merriweather (declare them in `fonts`) or system fonts |
| Preview iframe is blank | The preview HTML is rendered under a strict CSP in a sandboxed iframe; a template that loads anything external is blocked | Inline everything ([add-a-template.md](add-a-template.md)) |
| Chromium cannot launch locally | None found | Install Chrome or Chromium, or `pnpm exec playwright install chromium`, or set `CHROMIUM_PATH` |
| `404 Unknown download` | The file kind is not one of `original`, `resume.pdf`, `resume.docx`, `cover-letter.pdf`, `cover-letter.docx` | Use one of those |

## Sign-in and sessions

| Symptom | Cause | Fix |
| --- | --- | --- |
| Signed out on every reload | The refresh cookie is not stored: `COOKIE_SECURE=true` over plain http, or the web app and API on different origins | Use one origin; on http set `COOKIE_SECURE=false` (compose does) |
| `403 CORS_ORIGIN_DENIED` | A non-GET request from an `Origin` not in `CORS_ORIGINS` | Add the origin, or call through the web app's `/api` proxy |
| `401 SESSION_EXPIRED` | A revoked or replayed refresh token | Sign in again. A replayed token ends the whole session family by design |
| `429 RATE_LIMITED` with `Retry-After` | A rate limit or the sign-in failure budget (5 failures per account and IP per 15 minutes) | Wait; the limits are per user or IP |
| `403 ACCOUNT_RESTRICTED` | The account is suspended: it can read but not change | An admin lifts it in `/admin/users`; timed suspensions lift themselves |
| `403 ACCOUNT_BANNED` / `ACCOUNT_DEACTIVATED` | Banned or deleted | Contact the administrator |
| Two-factor code always rejected | Clock drift on the phone | Sync the time; or use a recovery code |
| Locked out as the only admin | | `make admin EMAIL=you@example.com` locally, `make aws-admin ENV=... EMAIL=...` on AWS |

## Deployment

| Symptom | Cause | Fix |
| --- | --- | --- |
| The API exits with `Refusing to start with an insecure configuration` | The production guard found a default secret, local storage, outbox mail, inline jobs, a localhost URL, etc. | The message lists each; see [configuration.md](configuration.md#production-guard) |
| `<file> changed after it was applied; add a new migration instead` | An applied migration was edited | Restore the original, add a new `NNNN_*.sql` |
| `make aws-admin` exits non-zero and creates nothing | The set-password email could not be sent: SES identity unverified, or in the SES sandbox and the recipient is not verified | Verify the identity (and the recipient), then re-run |
| Services never become stable | The migrate task failed, or secrets still say `set-me` where a value is required | `aws logs` for the `migrate` and service groups `/open-resume/<name_prefix>/<service>` |
| `database ... connection limit` / `db-connections` alarm | Tasks times `DB_POOL_MAX` exceed the database | Lower `DB_POOL_MAX` or raise the instance class |
| Emails land in spam or do not arrive | SES domain DKIM not published, or sandbox | Publish `terraform output mail_dns_records`; request SES production access |
| 403 from the site after enabling CloudFront | The load balancer accepts only CloudFront | Use the CloudFront host name (`domain`), not the ALB's |
