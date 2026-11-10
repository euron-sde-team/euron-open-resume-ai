# Configuration reference

Every environment variable the API, the worker and the web app read, with its default and
purpose; the deployment settings edited in `/admin/settings`; and how the local compose
stack and Terraform set them.

The API and worker read one schema, [`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts),
validated with zod at boot (`Invalid configuration:` lists every bad value). Booleans
accept `true`, `false`, `1`, `0` or empty. Outside production the security-critical values
fall back to development defaults so `make up` works with no setup; with
`NODE_ENV=production` the [production guard](#production-guard) refuses to boot while any
of them is still a default.

A key value of `set-me` (the Terraform placeholder) or an empty string counts as **not
configured** for every provider key (`isRealKey` in `config.ts`). That is what lets
Terraform create the secrets before you have the keys.

The API never reads `.env` files. Set variables in the process environment (compose
`environment:`, ECS task definitions, your shell).

## API and worker

### Runtime and HTTP

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | set to `production` | `development`, `test` or `production`. Production turns the guard's problems into a boot failure |
| `PORT` | `5106` | no | API listen port |
| `PRODUCT_NAME` | `Euron Open Resume AI` | no | The default `appName` setting and the name used in emails until an admin sets one |
| `APP_WEB_URL` | `http://localhost:3630` | yes (not localhost) | The web app's public origin: emailed links and the CORS default. The guard refuses `localhost` and `127.0.0.1` |
| `PUBLIC_API_URL` | `http://localhost:5106` | no | The API's public origin: signed local-storage file URLs (`STORAGE=local`). Also the value the web app uses as its API base when set on the web service |
| `CORS_ORIGINS` | empty (then `APP_WEB_URL`) | yes | Comma-separated origins allowed with credentials. A non-GET request carrying any other `Origin` gets `403 CORS_ORIGIN_DENIED` |
| `TRUST_PROXY` | `1` | set per topology | Express `trust proxy` hop count: 1 behind the ALB, 2 behind CloudFront and the ALB (Terraform sets it), so `req.ip` is the client for rate limits and the audit log |
| `LOG_LEVEL` | `info` | no | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Under `NODE_ENV=test` the default `info` becomes `silent` |

`TZ` is not configuration: `index.ts`, `worker.ts` and `cli.ts` set `process.env.TZ = "UTC"`
before anything else loads.

### Database

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | unset (then `postgres://resume:resume@localhost:5552/resume`) | one of this or `DATABASE_SECRET_ARN` | A `postgres://` URL. Local, CI and compose |
| `DATABASE_SECRET_ARN` | unset | one of the two | AWS: the RDS-managed master secret (or the application role's secret). The password is fetched from Secrets Manager for every new connection and cached for 60 s, so a rotation needs no restart ([`db/connection-config.ts`](../../apps/api/src/db/connection-config.ts)) |
| `DB_HOST` | unset | with the ARN | Host when using `DATABASE_SECRET_ARN` |
| `DB_PORT` | `5432` | with the ARN | Port when using `DATABASE_SECRET_ARN` |
| `DB_NAME` | unset | with the ARN | Database name when using `DATABASE_SECRET_ARN` |
| `DB_USER` | unset | with the ARN | User name when using `DATABASE_SECRET_ARN` |
| `DB_SSL` | unset | recommended | `disable`, `require` or `verify-full`. Terraform sets `require` |
| `DB_SSL_CA_FILE` | unset | with `verify-full` | CA bundle file |
| `DB_POOL_MAX` | `10` | no | Connections per process. Each API and worker task has its own pool: keep tasks times this under the database's connection limit |
| `MIGRATE_ON_BOOT` | `false` | no | Apply pending migrations when the API starts. Compose and AWS run a separate one-shot `migrate` instead |
| `MIGRATIONS_DIR` | `db/migrations` next to the runner | no | Read only by [`db/migrate.ts`](../../db/migrate.ts). The image sets `/app/db/migrations` |

### Redis and jobs

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6489` | yes | BullMQ queues and the rate limiters. On AWS it holds the cache's AUTH token and uses TLS (Terraform injects it as a secret) |
| `JOBS_MODE` | `queue` | must be `queue` | `queue`: BullMQ, handlers run in the worker. `inline`: handlers run in the API process after commit (tests, tiny installs, `demo:seed`; no retries, no schedules). The guard refuses `inline` |

### Sessions, passwords and limits

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET` | development default | yes | Signs access tokens. At least 32 characters, different from `REFRESH_SECRET` |
| `REFRESH_SECRET` | development default | yes | Signs and hashes refresh tokens. At least 32 characters |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | no | Access token lifetime. The web app refreshes silently from its httpOnly cookie |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | no | Refresh token (session) lifetime |
| `COOKIE_SECURE` | `auto` | no | `true`, `false` or `auto` (secure when `APP_WEB_URL` is https). The refresh cookie is named `resume_refresh`, `httpOnly`, `SameSite=Lax`, path `/api/auth` |
| `BCRYPT_ROUNDS` | `12` | at least 12 | bcrypt cost, 4 to 15. The test suite uses 4 |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | no | New accounts confirm their email before signing in. `false` signs them in at once |
| `TOTP_ENCRYPTION_KEY` | derived from a public constant | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored TOTP secrets and keys the recovery-code HMAC. Do not rotate casually: every enrolled authenticator stops working |
| `RATE_LIMITS` | `on` (`off` under `NODE_ENV=test`) | leave on | `off` disables every rate limit (load tests only). Read live, not cached |
| `RATE_LIMIT_STORE` | `redis` (`memory` under `NODE_ENV=test`) | leave unset | Tests only: `redis` to exercise the Redis limiter under `NODE_ENV=test` |

Rate limits are keyed by user when signed in and by IP otherwise, backed by Redis so the
budget is shared by every API task. If Redis is unavailable each task falls back to its own
memory with the same budget (see [`middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts)).
Sign-in failures use a separate budget (5 per account and IP per 15 minutes, 50 per
account per hour).

### Storage

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `STORAGE` | `local` | `s3` | `local`: files under `DATA_DIR`. `s3`: a private bucket. The guard refuses `local` |
| `DATA_DIR` | `./data` relative to the working directory | no | Where `STORAGE=local` keeps files and `MAIL_MODE=outbox` keeps `.eml` messages. The image uses `/tmp/data` on ECS and a volume at `/app/data` in compose |
| `S3_BUCKET` | unset | yes with `s3` | Bucket name. Uploaded originals are stored as `resumes/<user id>/<resume id>/original.<ext>` |
| `S3_REGION` | unset | no | Bucket region (falls back to `AWS_REGION`) |
| `S3_PUBLIC_ENDPOINT` | unset | no | Browser-reachable S3 endpoint for presigned URLs (the emulator locally). The resume flows read and write files from the server only, so nothing currently uses it |
| `AWS_REGION` | `us-east-1` | yes on AWS | Region for the AWS SDK clients |
| `AWS_ENDPOINT_URL` | unset | no | Points the SDK at an emulator (Floci locally). Leave unset on AWS |
| `SIGNED_URL_TTL_SECONDS` | `900` | no | Lifetime of signed local-storage URLs. Currently unused by the resume flows |

AWS credentials are not environment variables of the app: ECS tasks use their task role;
`make up-aws` mounts your `~/.aws` and sets `AWS_PROFILE`; the emulator uses fixed test
credentials.

### Mail

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `MAIL_MODE` | `outbox` | `ses` or `smtp` | `outbox`: write `.eml` files under `DATA_DIR/outbox`. `smtp`: send through `SMTP_*`. `ses`: Amazon SES v2. The guard refuses `outbox` |
| `MAIL_FROM` | unset | yes unless `outbox` | The sender, `Name <address>`. SES refuses an unverified sender |
| `SMTP_HOST` | unset | with `smtp` | SMTP server (Mailpit locally) |
| `SMTP_PORT` | `587` | no | SMTP port |
| `SMTP_USER` | unset | no | SMTP login. Put it, and `SMTP_PASS`, in the secret store |
| `SMTP_PASS` | unset | no | SMTP password |
| `SES_REGION` | unset | with `ses` | SES region (falls back to `AWS_REGION`) |
| `SES_CONFIGURATION_SET` | unset | no | SES configuration set, for bounce and complaint events |

### Model providers

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `PROVIDER_KEYS` | unset | no | One JSON object keyed by provider **slug**: `{"openai":"<key>","anthropic":"<key>"}`. On AWS it comes from the Secrets Manager secret `<name_prefix>/provider-keys`. A malformed value is ignored and never echoed |
| `OPENAI_API_KEY` | unset | no | Shortcut for the provider with slug `openai` |
| `ANTHROPIC_API_KEY` | unset | no | Shortcut for slug `anthropic` |
| `GEMINI_API_KEY` | unset | no | Shortcut for slug `gemini` |
| `OPENROUTER_API_KEY` | unset | no | Shortcut for slug `openrouter` |
| `GROQ_API_KEY` | unset | no | Shortcut for slug `groq` |
| `STUBS_URL` | `http://localhost:5199` | not used | Where providers of kind `STUB` live (the deterministic fakes in `apps/stubs`) |

`PROVIDER_KEYS` wins over a shortcut that names the same slug. Keys never enter the
database, a log line or an API response. With no key at all the API still runs: every task
uses the offline engine, and the boot log warns `no model provider key is configured`.
How slugs, providers and models fit together: [connect-real-providers.md](connect-real-providers.md).

### PDF rendering

| Variable | Default | Required in production | Purpose |
| --- | --- | --- | --- |
| `CHROMIUM_PATH` | unset (first system Chrome or Chromium, then Playwright's) | set in the image | Chromium binary for PDF export. The image sets `/usr/bin/chromium` |
| `CHROMIUM_NO_SANDBOX` | unset | `1` in containers | Turn Chromium's own sandbox off where the container cannot grant it. The renderer blocks every request except `data:` and `about:` and runs with JavaScript off |
| `PDF_CONCURRENCY` | `2` | no | Pages rendered at once per process (1 to 8). More wait in a bounded queue (25); a full queue makes the render fail with "The PDF engine is busy" (`503 PDF_UNAVAILABLE` from the builder export, see [troubleshooting.md](troubleshooting.md#export-and-rendering)) |
| `PDF_RECYCLE_PAGES` | `100` | no | The shared Chromium restarts after this many pages to cap memory growth (minimum 10) |
| `TEMPLATES_DIR` | unset (found next to the source or the bundle) | set in the image | Where the EJS templates live. The image sets `/app/dist/templates` |

### Operator tools

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_PASSWORD` | unset (random, printed once) | `demo:seed` only: the password every demo account gets. `make demo` passes `RESUME_DEMO_PASSWORD` |

## Production guard

`assertProductionConfig` returns a list of problems. In development it only logs them as
`config:` warnings; with `NODE_ENV=production` the API refuses to start and prints all of
them. It refuses:

| Problem | Fix |
| --- | --- |
| `JWT_SECRET` or `REFRESH_SECRET` still the committed default, shorter than 32 characters, or equal to each other | Generate two distinct secrets of 32 or more characters |
| `TOTP_ENCRYPTION_KEY` not set | `openssl rand -base64 32` |
| `CORS_ORIGINS` not set | Your public origin |
| `APP_WEB_URL` points at localhost | Your public origin |
| `STORAGE=local` | `STORAGE=s3` and `S3_BUCKET` |
| `STORAGE=s3` without `S3_BUCKET` | Set it |
| `MAIL_MODE=outbox` | `ses` or `smtp` |
| `MAIL_MODE` other than outbox without `MAIL_FROM` | Set it |
| `JOBS_MODE=inline` | `queue` |
| `BCRYPT_ROUNDS` below 12 | Leave the default |

The worker runs the same check but only logs the problems. A missing provider key is a
**warning**, never a boot failure: the app runs on the offline engine, and an administrator
can sign in to fix it. Terraform sets every one of these correctly
([deploy-aws.md](deploy-aws.md)).

## Secrets handling

- Secrets live in AWS Secrets Manager (`<name_prefix>/app` for `JWT_SECRET` and
  `REFRESH_SECRET`, `<name_prefix>/totp`, `<name_prefix>/provider-keys`, the cache's
  secret for `REDIS_URL`, and RDS's own secret for the database password) and ECS injects
  them as environment variables; nothing secret is in a task definition, an image or a log.
- Terraform never overwrites a secret after creating it (`ignore_changes`), so values you
  put in by hand stay. Rotation procedures: [operations.md](operations.md#rotating-secrets).
- Locally, `make env` writes random throwaways to `deploy/compose/.env`
  (git-ignored). Do not reuse them anywhere real.
- The logger redacts passwords, tokens, one-time codes, cookies and authorization headers
  by field name up to three levels deep ([`core/logger.ts`](../../apps/api/src/core/logger.ts)).
  Resume text, job descriptions and chat content are not logged at all: only task names,
  ids, counts and token totals.
- Provider failures reach users only as a stable message; the provider's own error text
  stays in the server log, truncated.

## Web app

The Next server reads these at run time (the image is one build for every environment):

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_INTERNAL_URL` | `http://localhost:5106` (`http://api:5106` in the image) | Where Next proxies `/api/*`. Set at build and at run time in the image |
| `PRODUCT_NAME` | `Euron Open Resume AI` | The name in the header, titles and copy, served to the browser through `GET /env.js` |
| `PUBLIC_API_URL` | `/api` | API base the browser uses. Leave unset: same origin is what keeps the refresh cookie first-party |
| `NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_API_URL` | unset | Build-time fallbacks for `next dev` |
| `MEDIA_ORIGINS` | unset | Space or comma separated origins added to the Content-Security-Policy `img-src` and `media-src` (the S3 bucket, a CDN). Compose and Terraform set it |
| `PORT` | `3000` in the image, `3630` with `pnpm dev` / `pnpm start` | Listen port |

## Deployment settings (`/admin/settings`)

Stored as one JSON document in the `settings` table, merged over the defaults, cached for
5 seconds per process, audited with before and after values.

| Setting | Default | Purpose |
| --- | --- | --- |
| `appName` | `PRODUCT_NAME` | Name shown in the app and emails |
| `tagline` | `Sharper resumes, in minutes.` | Short line under the name |
| `registration` | `OPEN` | `OPEN`, `INVITE_ONLY` (only addresses in `allowedEmailDomains`) or `CLOSED` |
| `allowedEmailDomains` | empty | Up to 100 domains, for `INVITE_ONLY` |
| `supportEmail` | null | Shown to members |
| `systemPromptAddendum` | empty | Up to 4,000 characters added to every AI request, for house rules and tone |
| `features` | empty | Boolean feature flags, read by clients through `GET /api/meta` |
| `minSupportedVersion` | null | `x.y.z`; older mobile clients are asked to update |

Per-account limits (monthly runs, resume count, upload size) are not settings: they are
quota tiers and overrides ([operations.md](operations.md#quotas-administration)).

## How compose and Terraform set these

- **Compose** ([`compose.yaml`](../../deploy/compose/compose.yaml)) builds one `x-api-env`
  block shared by `api`, `worker` and `migrate`. Its variables are `${NAME:-default}`
  interpolations, so `deploy/compose/.env` or your shell can override them. Local secrets are
  prefixed `RESUME_`: `RESUME_JWT_SECRET`, `RESUME_REFRESH_SECRET`,
  `RESUME_TOTP_ENCRYPTION_KEY`, `RESUME_DEMO_PASSWORD`. Host ports are `RESUME_WEB_PORT`,
  `RESUME_API_PORT`, `RESUME_PG_PORT`, `RESUME_REDIS_PORT`, `RESUME_MAILPIT_PORT`,
  `RESUME_SMTP_PORT`, `RESUME_FLOCI_PORT` and `RESUME_STUB_PORT`. `RESUME_PRODUCT_NAME` and
  `RESUME_LOG_LEVEL` are compose-level aliases of `PRODUCT_NAME` and `LOG_LEVEL`. The Floci
  overlay switches `STORAGE=s3`, `MAIL_MODE=ses` and points the SDK at the emulator; the
  AWS overlay reads `deploy/compose/.env.aws` ([`.env.aws.example`](../../deploy/compose/.env.aws.example)).
- **Terraform** ([`modules/deployment`](../../infra/terraform/modules/deployment/main.tf))
  builds the production environment for the API and worker (`NODE_ENV=production`,
  `STORAGE=s3`, `MAIL_MODE=ses`, `COOKIE_SECURE=true`, `JOBS_MODE=queue`, the database
  connection through `DATABASE_SECRET_ARN`) and the secrets. Inputs that reach it:
  `product_name`, `log_level`, `require_email_verification`, `provider_keys`,
  `api_extra_environment` (plain variables) and `api_extra_secrets` (ECS secret
  references, for example `SMTP_PASS`).
- **Stubs** (`apps/stubs`) read `PORT` (default 5199) and `STUB_PUBLIC_URL`.
- **End-to-end tests** read `E2E_BASE_URL`, `E2E_API_URL`, `E2E_MAILPIT_URL`,
  `E2E_STUBS_URL`, `E2E_DEMO_PASSWORD`, `E2E_WORKERS`, `E2E_HEADED` and `E2E_BROWSER_PATH`
  ([testing.md](testing.md#end-to-end-tests)); the integration suite reads `TEST_DATABASE_URL`
  and `TEST_REDIS_URL`.
