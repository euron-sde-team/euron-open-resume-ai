# Testing

Four layers, from fast and hermetic to the whole stack, plus the repository scans that run
with them. Every gate is runnable locally; CI runs the first, second and fourth on every
push.

| Layer | Command | Needs | What it proves |
| --- | --- | --- | --- |
| Lint and types | `make lint`, `make typecheck` | Node 22, `pnpm install` | Style, strict TypeScript across every package |
| Unit | `make test` (`pnpm test`) | Nothing running (the PDF tests need a Chromium and skip without one) | Pure rules, the offline engine, renderers, the API client, UI components |
| API integration | `make test-integration` | Postgres 16, Redis 7 | The real HTTP API, in-process, against a real database |
| Backend matrix | `make test-matrix` | `make up` (Postgres, Redis, Floci, Mailpit) | The integration suite under every storage and mail backend |
| Browser end to end | `make e2e` | `make up` and `make demo` | Real screens against the whole stack |
| Repository scans | `make sanitize`, `pnpm openapi --check`, `make tf-validate tf-lint tf-security` | Docker for the Terraform ones | Nothing publishable leaks; the API reference matches the routes; the infrastructure validates |

## Unit tests

`pnpm test` runs `vitest` in every package through Turborepo:

| Package | Covers |
| --- | --- |
| `apps/api` (`test/unit`) | Display names and usernames, HTTP and provider-error mapping, the LLM adapters (OpenAI, Anthropic, Gemini wire formats), logger redaction, text extraction and file sniffing, the resume document normaliser, the component state machine, rendering (mapper, link safety, template allow-list, HTML for every template, DOCX, PDF), the offline engine (`resume-ai/offline-engine.test.ts`, `offline-parse.test.ts`), the structured-output schemas, the stub contract |
| `apps/web` | Components and flows: auth, resume screens, admin pages (`test/mock-api.mjs` is a separate stand-in API for running the web app without the real one, not used by the tests) |
| `apps/stubs` | The wire formats and decisions of the model stub |
| `packages/api-client` | HTTP client, pagination, uploads, the resume calls |
| `packages/samples` | The 60 sample resumes are valid, ASCII only and use known template ids |
| `packages/ui`, `packages/types` | Components, class merging; types compile |

The PDF tests (`render.test.ts`) launch headless Chromium and are skipped when none is found,
so a green run on a machine without one has not exercised PDF export. Install one or set
`CHROMIUM_PATH`
([troubleshooting.md](troubleshooting.md#export-and-rendering)). One package:
`pnpm --filter @open-resume/api test`, one file: `pnpm --filter @open-resume/api exec vitest run test/unit/render.test.ts`.

## API integration tests

```bash
make test-integration
# or, against your own services:
TEST_DATABASE_URL=postgres://resume:resume@localhost:5552/resume_test \
TEST_REDIS_URL=redis://localhost:6489/1 pnpm test:integration
```

`make test-integration` first runs [`scripts/test-db.sh`](../../scripts/test-db.sh): if
nothing answers on the Postgres (5552) and Redis (6489) ports it runs `make env` and starts
just those two compose services; otherwise it does nothing. It then runs
[`vitest.integration.config.mts`](../../vitest.integration.config.mts).

What the setup does ([`global-setup.ts`](../../apps/api/test/integration/global-setup.ts),
[`env.ts`](../../apps/api/test/integration/env.ts)):

- **Refuses anything but a disposable database.** `TEST_DATABASE_URL` must name a database
  ending in `_test` ([`guard.ts`](../../apps/api/test/integration/guard.ts)); it is dropped and
  recreated, then migrated, once per run. It never touches `resume`. The role needs
  `CREATEDB` (the compose Postgres user already has it).
- Empties the test Redis logical database (only a numbered, non-zero one; `/1` by default).
- Starts the stubs (`apps/stubs`) in-process on an ephemeral port and points `STUBS_URL` at it.
- Sets `NODE_ENV=test`, `JOBS_MODE=inline` (jobs run in the request, so assertions are
  deterministic), `BCRYPT_ROUNDS=4`, rate limits off (a test turns them on to assert a 429),
  `STORAGE=local`, `MAIL_MODE=outbox`, and `OPENAI_API_KEY` to a canary value.
- Mounts the app in-process ([`harness.ts`](../../apps/api/test/integration/harness.ts)), seeds
  the starter catalogue with the stub provider and offers helpers (`createUser()`,
  `as(user).get(...)`).
- Files share one database, so they run one at a time. Each test creates its own users and
  resumes, and a test that changes shared state (settings, the default tier, the model
  catalogue) restores it.

| File | Covers |
| --- | --- |
| `resumes.int.test.ts` | Upload validation (type, size, sniffing), the pipeline with fake AI tasks, quotas, retry, tailor, components, delete, download, render, drafts, usage, ownership (another user's resume is a 404) |
| `resume-ai-tasks.int.test.ts` | The AI seam end to end, through the stub provider and offline |
| `builder-ai.int.test.ts`, `builder.int.test.ts` | Builder chat and import (auth, quota, charge and refund, stub path, offline engine); templates, live preview, PDF and DOCX export |
| `quotas.int.test.ts` | Tiers, overrides, atomic charging under concurrency, the resume cap, what is recorded |
| `auth.int.test.ts`, `native-auth.int.test.ts`, `account.int.test.ts` | Sign-up and verification, sign-in throttling, refresh rotation and reuse detection, password reset, two-factor and recovery codes; native token mode; export and deletion with its grace period |
| `admin.int.test.ts` | Who may open `/admin`, accounts, tiers, providers and models (never a key, never provider text), settings, stats, the audit trail |
| `hardening.int.test.ts` | The error envelope, body limits, headers and CORS, request ids, id and cursor validation, `LIKE` escaping, rate limits |
| `secrets.int.test.ts` | The provider key canary (below) |

### The provider key canary

`secrets.int.test.ts` runs with `OPENAI_API_KEY=sk-test-canary-value`, then walks every kind
of response a member and an admin can fetch, and the database, and asserts the canary is
nowhere, while the admin providers list still reports `keyConfigured: true`. A change that
echoes a key anywhere fails here.

## Backend matrix

```bash
make up            # Postgres, Redis, Floci, Mailpit
make test-matrix   # 2 storage backends x 3 mail backends = 6 runs
ONLY=s3 make test-matrix                 # only rows whose label contains "s3"
FILTER=resumes make test-matrix          # only matching test files
```

[`scripts/test-matrix.sh`](../../scripts/test-matrix.sh) runs the integration suite for
`STORAGE` in `local`, `s3` (Floci) and `MAIL_MODE` in `outbox`, `smtp` (Mailpit) and `ses`
(Floci relayed to Mailpit). Each row gets its own `resume_matrix_NN_test` database and Redis
logical database, so no state carries over. It prints a table and exits non-zero if any
combination fails.

## End-to-end tests

```bash
make e2e                                  # make up, make demo, then pnpm e2e
pnpm e2e                                  # against a running stack
pnpm e2e e2e/tests/01-auth.spec.ts        # one spec
E2E_HEADED=1 pnpm e2e                     # watch it
```

[Playwright](../../e2e/playwright.config.ts) drives Chromium at 1440 x 900 against the
running stack (`make up` and `make demo`): the web app, API and worker, Postgres, Redis,
Floci, Mailpit and the stubs. `globalSetup` waits for `/api/ready` and the web app first.
Every spec creates its own people through the API, so spec files run in parallel
(`E2E_WORKERS`, default 4) and never see each other's data; tests inside a file run in order.
Verification emails are read from Mailpit.

| Spec | Covers |
| --- | --- |
| `01-auth` | Signed-out redirects that remember where you were going, sign-in and a wrong password, the demo accounts and the admin entry, the empty state |
| `02-upload-analyse` | Upload with a job description, watch the analysis, read the report; someone else's resume is a 404; a scanned or unreadable file is refused and no run is used |
| `03-builder` | Build by chatting, live preview, hand edits, save, reopen, download, analyse |
| `04-templates-export` | Pick another template, download the resume and cover letter; samples search, preview and use |
| `05-admin-quotas` | A one-run tier (the first analysis works, the next is refused plainly), the quotas page, an admin never sees anyone's resumes |
| `06-accessibility` | axe-core on the main pages in light and dark, dialogs trap focus and close on Escape, icon buttons have names |

Environment: `E2E_BASE_URL` (default `http://localhost:3630`), `E2E_API_URL`
(`http://localhost:5106/api`), `E2E_MAILPIT_URL`, `E2E_STUBS_URL`, `E2E_DEMO_PASSWORD` (else
read from `deploy/compose/.env`), `E2E_BROWSER_PATH` (a system Chrome when Playwright's is not
installed: `pnpm exec playwright install chromium` otherwise). Reports land in `e2e/.report`
and failures in `e2e/.results`. Stable `data-testid` hooks are listed in
[`apps/web/TESTIDS.md`](../../apps/web/TESTIDS.md).

## The stubs

[`apps/stubs/server.mjs`](../../apps/stubs/server.mjs) is one dependency-free Node process
that speaks the OpenAI chat wire format (streaming or not, JSON mode, usage), so the real
provider adapter runs in every test. Recognised resume tasks (the system prompt starts with
`[task:<name>]`) get deterministic answers; anything else echoes. Words in the last user
message steer it:

| Words | What the model does |
| --- | --- |
| `slow` | Streams 40 sentences, 60 ms apart |
| `fail` | Answers 500 |
| `ratelimit` | Answers 429 |
| `context overflow` | Answers 400 `context_length_exceeded` |

`GET /__/requests` lists every request received (bodies, and whether a key was sent) and
`POST /__/reset` clears them. Keys are never checked. To test a new provider kind, teach the
stub its wire format so the suite stays hermetic.

## The sanitizer

`make sanitize` runs [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh)
over exactly the files git would commit (tracked plus untracked and not ignored). It fails on
cloud access keys, private key blocks, 12-digit numbers that may be AWS account ids, AWS
resource ids (`subnet-...`), RDS endpoints, Slack, GitHub, Stripe, OpenAI and Anthropic style
tokens, model and search provider keys, em dashes, and email addresses outside the reserved
example domains. Placeholder-looking values (all zeros, `123456789012`) are allowed. Run it
before every pull request; CI runs it too.

This is the repository scan. The runtime equivalents, tested in the unit and integration
suites, are: resume links pass `safeHref` (only `http`, `https`, `mailto`, `tel`), every
template escapes its output and loads nothing external, and prompts fence user text as data.

## The OpenAPI check

`docs/api/openapi.yaml` is generated from the route files by
[`scripts/gen-openapi.ts`](../../scripts/gen-openapi.ts): `pnpm openapi` regenerates it and
`pnpm openapi --check` fails when it is stale (CI runs the check). Keep each route to one
`router.<method>("<path>", ...guards, ctrl.fn);` with a `/** doc comment */` above it.

## CI

| Workflow | Runs | On |
| --- | --- | --- |
| [`checks`](../../.github/workflows/checks.yml) | lint, typecheck, unit tests, build, `pnpm openapi --check`, `scripts/check-sanitization.sh`; the integration tests on Postgres 16 and Redis 7 service containers; `terraform fmt -check` and `validate` for every environment | Every push to `main` and every pull request |
| [`workflows-full/`](../../.github/workflows-full/README.md) | The complete pipeline: image builds (multi-arch, pushed to GHCR on tags), gitleaks and CodeQL and `pnpm audit`, the full stack on the emulator with the backend matrix and the browser tests | Opt-in: move the files into `.github/workflows/` in your fork |

Everything CI runs can be run locally with
`make lint typecheck test build test-integration sanitize tf-validate` plus `pnpm openapi --check`.
