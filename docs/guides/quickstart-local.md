# Quickstart: run Euron Open Resume AI locally

Start the whole stack on your machine with emulated AWS, seed demo accounts and analysed
resumes, and use every feature without a cloud account or a model API key. With no provider
key, every AI task (analysis, improved resume, cover letter, interview questions, roadmap,
project ideas, the chat builder) runs on a deterministic offline engine built into the API;
adding a real key later is one line ([connect-real-providers.md](connect-real-providers.md)).

What runs ([`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml) plus
[`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)): Postgres 16, Redis 7,
Mailpit, the Floci AWS emulator provisioned by the production Terraform modules, the stubs
(a deterministic OpenAI-compatible model endpoint), then a one-shot `migrate`, the `api`,
the `worker` and the `web` app. The API renders previews and PDFs with headless Chromium.

## Prerequisites

- Docker with Compose v2 (Docker Desktop, OrbStack, Colima or plain Docker Engine), about
  4 GB of memory for the containers (the worker is capped at 2 GB, the API at 1.5 GB; Chromium runs in the API).
- `make`, `bash` and `openssl` (for `make env`).
- For the tests and for running the apps outside Docker: Node 22 (`.nvmrc`) and pnpm 9
  (`corepack enable`), then `pnpm install`.

## Start the stack

```bash
make up
```

`make up` runs `make env` first: it writes `deploy/compose/.env` with random, local-only
secrets (`RESUME_JWT_SECRET`, `RESUME_REFRESH_SECRET`, `RESUME_TOTP_ENCRYPTION_KEY`,
`RESUME_DEMO_PASSWORD`) and never overwrites a value
([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)). Then it builds the images,
waits for the `terraform` one-shot to create the bucket and the mail identity inside Floci,
runs the migration and waits until every service is healthy. The first build takes a few
minutes. When it is done it prints:

```
  app      http://localhost:3630
  api      http://localhost:5106/api/ready
  mail     http://localhost:8106
  s3/ses   http://localhost:4657  (Floci)
  stubs    http://localhost:5199  (OpenAI-compatible model stand-in)
```

Check the API: `curl -s localhost:5106/api/ready` answers `{"ok":true}` when Postgres and
Redis respond.

## Ports

Every host port binds to `127.0.0.1` and can be moved in `deploy/compose/.env` (or your
shell) if it clashes with something else:

| Service | Host port | Variable |
| --- | --- | --- |
| Web app (and the `/api` proxy) | 3630 | `RESUME_WEB_PORT` |
| API | 5106 | `RESUME_API_PORT` |
| Postgres | 5552 | `RESUME_PG_PORT` |
| Redis | 6489 | `RESUME_REDIS_PORT` |
| Mailpit web UI / SMTP | 8106 / 1106 | `RESUME_MAILPIT_PORT` / `RESUME_SMTP_PORT` |
| Floci (S3, SES) | 4657 | `RESUME_FLOCI_PORT` |
| Stubs | 5199 | `RESUME_STUB_PORT` |

The browser only ever talks to the web app: Next proxies `/api/*` to the API
(`API_INTERNAL_URL`), so the refresh cookie is first-party exactly as behind the load balancer
on AWS. The API port is published for curl and the integration tools.

## Seed the demo

```bash
make demo
```

This runs `node dist/cli.js demo:seed` inside the API container
([`apps/api/src/demo/seed.ts`](../../apps/api/src/demo/seed.ts)) with `DEMO_PASSWORD` set to
`RESUME_DEMO_PASSWORD` from `deploy/compose/.env`. It creates:

- the starter model catalogue ([`demo/catalog.ts`](../../apps/api/src/demo/catalog.ts)):
  providers `openai`, `anthropic` and `gemini` with a few models each (not offered until
  their key is set) and the **Local stub** provider with one model, `Stub`. The stub is
  created **disabled**, so a fresh demo analyses uploads with the offline engine; switch it
  on in `/admin/models` to send the same work through the real provider path;
- an admin and four members, a `Staff` quota tier (Leo is on it: 200 runs a month, 50
  resumes, 25 MB uploads), and some monthly usage for the admin overview;
- analysed resumes for the four members, built from the synthetic samples
  ([`demo/resumes.ts`](../../apps/api/src/demo/resumes.ts)), run inline through the real
  pipeline with the offline engine, so the app opens with reports to read.

It refuses to run with `NODE_ENV=production`. Running it again only prints the logins.

| Account | Email | Role |
| --- | --- | --- |
| Morgan Ellis | `admin@example.com` | ADMIN: `/admin` |
| Priya Nair | `priya.nair@example.com` | USER |
| Leo Marquez | `leo.marquez@example.com` | USER, on the `Staff` tier |
| Sam Kowalski | `sam.kowalski@example.com` | USER |
| Amara Okafor | `amara.okafor@example.com` | USER |

Every demo account signs in with the password `make demo` prints (`RESUME_DEMO_PASSWORD` in
`deploy/compose/.env`). A tour of what to click is in [walkthrough.md](walkthrough.md).

## Create your own account

Sign up at http://localhost:3630/signup. The local stack keeps email verification on
(`REQUIRE_EMAIL_VERIFICATION=true`), so open http://localhost:8106 (Mailpit), click the link
in the message, and you are signed in. To make your account an administrator:

```bash
make admin EMAIL=you@example.com
```

That promotes an existing account without touching its password, or creates the account and
mails a set-password link (readable in Mailpit).

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Web (Next 15) | `web` container, host 3630 | Proxies `/api/*` to the API; `GET /env.js` hands the product name to the browser at run time |
| API (Express 5) | `api` container, host 5106 | REST, auth, uploads, previews and exports; `GET /up` (process) and `GET /api/ready` (Postgres + Redis) |
| Worker | `worker` container, no port | BullMQ queues `resume-ai` and `maintenance`; runs the AI pipeline and the upkeep schedules |
| Migrations | `migrate` one-shot | Applies `db/migrations/*.sql`, then exits 0; the API and worker wait for it |
| Postgres 16 | `postgres`, host 5552 | User, password and database are all `resume` locally |
| Redis 7 | `redis`, host 6489 | Queues, rate limits; a plain container (Floci does not back ElastiCache with a server) |
| S3, SES, KMS, Secrets Manager | `floci` + `terraform` one-shot | The bucket `open-resume-local-media` and the mail identity `resume.example.test` come from the same Terraform modules as production |
| Mail | `mailpit`, host 8106 | Every message, including those relayed by the emulated SES |
| Model stub | `stubs`, host 5199 | OpenAI-compatible; `GET /__/requests` lists what the API sent it |

The compose files set `NODE_ENV=development`, so the production guard only warns; see
[configuration.md](configuration.md#production-guard).

## Run the apps outside Docker

Useful when you are changing code. You need a Postgres 16 and a Redis; the API's defaults
already point at the ports of the compose stack, so no environment file is needed.

1. Postgres on port 5552 with a role `resume` (password `resume`) owning a database
   `resume`. Either start only the containers (`docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml up -d postgres redis`, after `make env`) or use a native server and create them:

   ```sql
   CREATE ROLE resume LOGIN CREATEDB PASSWORD 'resume';   -- CREATEDB: the integration tests recreate resume_test
   CREATE DATABASE resume OWNER resume;
   ```

   Use another port or host with `DATABASE_URL=postgres://user:pass@host:port/db`.
2. Redis on port 6489 (`redis-server --port 6489`), or set `REDIS_URL`.
3. Install, migrate, run:

   ```bash
   pnpm install
   pnpm db:migrate                       # applies db/migrations; add --status to only list
   pnpm dev                              # api (tsx watch, 5106) and web (next dev, 3630)
   pnpm --filter @open-resume/api dev:worker    # a second terminal: the AI pipeline
   ```

   Without the worker, uploads sit in `queued` because `JOBS_MODE` defaults to `queue`.
   Set `JOBS_MODE=inline` to run job handlers inside the API process instead (no retries,
   no schedules; fine for a quick look).
4. Optional: `pnpm demo:seed` seeds the demo (set `DEMO_PASSWORD` to choose the password,
   otherwise a random one is printed once), and
   `pnpm --filter @open-resume/stubs start` starts the model stub on 5199.

Differences from the compose stack, all from the defaults in
[`config.ts`](../../apps/api/src/core/config.ts):

- Files are stored on disk (`STORAGE=local`) under `./data` relative to where the API runs
  (`apps/api/data` with `pnpm dev`; set `DATA_DIR` to move it).
- Mail is written to `data/outbox/*.eml` (`MAIL_MODE=outbox`), not sent. With email
  verification on, open the newest `.eml` for the link, run Mailpit and set
  `MAIL_MODE=smtp SMTP_HOST=localhost SMTP_PORT=1106`, or set `REQUIRE_EMAIL_VERIFICATION=false`.
- PDF export needs a Chromium: a system Chrome or Chromium (or Playwright's) is found
  automatically, otherwise set `CHROMIUM_PATH`. See [troubleshooting.md](troubleshooting.md#export-and-rendering).
- The API does not read `.env` files; export variables in your shell, or put them in the
  command (`DATABASE_URL=... pnpm dev`). `pnpm db:migrate` does load a `.env` in the repo root.

## Stop and reset

```bash
make down      # stop everything and delete the volumes (database, files, emulator state)
make logs SERVICE=api    # tail one service: api, worker, web, stubs, migrate, floci, terraform, ...
make ps        # status
```

`deploy/compose/.env` survives `make down`; delete it to generate new secrets.

## Next

- Click through every screen: [walkthrough.md](walkthrough.md).
- Run the tests: [testing.md](testing.md).
- Every setting: [configuration.md](configuration.md).
- Use a real model: [connect-real-providers.md](connect-real-providers.md).
- Deploy it: [deploy-aws.md](deploy-aws.md).
