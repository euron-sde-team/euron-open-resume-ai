# Contributing

Thanks for helping improve Euron Open Resume AI. This guide covers the workflow, the bar a
change has to clear, and the conventions the codebase follows.

## Ground rules

- **Open an issue first** for anything larger than a bug fix or a docs tweak, so we can
  agree on the approach before you invest time.
- **One concern per pull request.** A refactor and a feature are two PRs.
- **Security issues go through private reporting**, never a public issue. See
  [SECURITY.md](SECURITY.md).
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Development setup

Requirements: Docker, Node 22+, pnpm 9 (`corepack enable`).

```bash
pnpm install
make up          # Postgres, Redis, the AWS emulator (provisioned by Terraform), Mailpit,
                 # the model stub (apps/stubs),
                 # then migrate, api, worker and web
make demo        # an admin, four members, providers and models on the Stub provider,
                 # analysed sample resumes (prints the logins and the demo password)
make test        # unit tests across every package
```

The app is at http://localhost:3630 and every mail it sends is readable at
http://localhost:8106. No provider key is needed: until an admin adds one, the AI runs on the
deterministic offline engine, and the demo's Stub provider answers deterministically when
enabled. [docs/guides/quickstart-local.md](docs/guides/quickstart-local.md) lists every port,
how to run the apps outside Docker and how to add a real key.

## Before you open a pull request

Each of these must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
make test-integration            # API (HTTP) against a real Postgres and Redis, stubs in-process
make test-matrix                 # when you touched storage or mail backends
make e2e                         # when you touched a user flow or infrastructure
make tf-validate tf-lint tf-security   # when you touched infra/terraform
pnpm openapi --check             # when you touched a route (pnpm openapi regenerates)
make sanitize                    # no credentials, account ids, real emails, IPs or em dashes
```

[docs/guides/testing.md](docs/guides/testing.md) explains each layer and the stub trigger
words that steer the fake model. Tests that render PDFs are skipped when no Chromium is
installed: install one before you change anything under `render/`.

## Conventions

**Layers (api).** Routes declare endpoints and guards; controllers parse the request with
strict zod schemas and write the response; services hold the business rules and take an
`Actor`, never a request; repositories hold the Kysely queries; presenters build DTOs field
by field. Background work (the resume AI pipeline, upkeep) is a BullMQ job enqueued after the
transaction commits (`fx.job(...)` in `core/effects.ts`), carrying ids only. Pure rules (the document normaliser,
file sniffing, the offline engine, the template mapper, link safety) have unit tests
([LLD.md](docs/architecture/LLD.md)).

**Every query is scoped to its owner.** A resume, component, draft, session or file is read
with the actor's id in the query, and another account's id is a 404, never a 403. A new
endpoint that returns user content gets an integration test proving a second account cannot
read it. Admin endpoints never return resume content.

**Clients reference resumes by id.** Never accept or return a storage key; keys are built on
the server (`resumes/<user id>/<resume id>/original.<ext>`).

**Provider keys stay in the environment.** Never add a key column, a key field to a DTO, or a
log line that could carry one. Keys are looked up from `PROVIDER_KEYS` by provider slug at
call time. Provider failures reach users only as a stable code and message
(`failFromResponse`, `mapProviderError`); the provider's own text stays in the log, masked.

**User text is data, not instructions.** Resume text, job descriptions, company names and chat
messages reach a model only through `untrusted()` blocks in `services/resume/ai/limits.ts`,
capped in size, and the system prompts declare them to be data. Never concatenate user text
into a system prompt. The API never fetches a URL a user supplied, and rendered documents load
nothing external: templates escape every field (`<%=`), links go through `safeHref`, the
preview is a sandboxed iframe under a strict CSP, and the PDF renderer runs with JavaScript
off and every request but `data:` and `about:` blocked
([security.md](docs/architecture/security.md)).

**The offline engine is the contract.** With no usable text model every AI task must still
produce a valid result from `services/resume/ai/offline`. A new task or a new field is added to
the offline engine and to the model path together, validated by the same zod schema in
`services/resume/ai/schemas.ts`. A configured model that fails is an error, never a silent
downgrade to the offline engine.

**Quotas are charged before the work and refunded on our failure.** A run is taken with
`chargeRuns` (atomic, under a per-user advisory lock), the job is enqueued, and a failure on
our side calls `refundRuns`. A new AI feature declares its cost and `chargeKind` in
`services/resume/components.ts` or charges explicitly like the builder routes do, and gets a
quota test ([quotas.md](docs/architecture/quotas.md)).

**Jobs are idempotent.** A handler takes its work with a conditional `UPDATE` (a claim) so a
duplicate delivery or a second worker does nothing, and retries are bounded
([resume-pipeline.md](docs/architecture/resume-pipeline.md)).

**No resume text in logs or usage rows.** Log ids, task names, counts and token totals; the
logger redacts secrets by field name, but do not rely on it for content.

**The shared types are a contract.** `packages/types` is read by the web app, the API client
and mobile clients. Add fields, do not rename or remove them.

**Routes stay declarative.** One `router.<method>("<path>", ...guards, ctrl.fn);` per
endpoint with a `/** doc comment */` above: `scripts/gen-openapi.ts` builds
docs/api/openapi.yaml from exactly that shape. Run `pnpm openapi` and commit the result.

**Configuration is validated.** Every environment variable is declared in
`apps/api/src/core/config.ts` and nowhere else; a new one is documented in
[docs/guides/configuration.md](docs/guides/configuration.md) in the same PR, and
security-relevant ones are enforced at boot by `assertProductionConfig`.

**Database changes are new migrations.** Add `db/migrations/NNNN_description.sql` and update
`apps/api/src/db/types.ts`. Never edit an applied migration: the runner refuses to start when
a checksum changes ([operations.md](docs/guides/operations.md#migrations)).

**Templates have a checklist.** A new resume template is an EJS file plus entries in
`TEMPLATE_IDS`, the registry and the sample validator, a preview image, and tests that
already loop over every template
([add-a-template.md](docs/guides/add-a-template.md)).

**New providers get stubs.** Teach `apps/stubs/server.mjs` to speak a new wire format or answer
a new task, so the integration suite stays hermetic
([ai-engine.md](docs/architecture/ai-engine.md)).

**The repository stays publishable.** Example addresses use `example.com`; no real emails,
account ids, hostnames or keys; no em dashes anywhere (code, copy or docs). `make sanitize`
checks all of it.

**Comments explain why.** The code says what it does. Comments are for the constraint, the
incident, or the trade-off that made it this way.

**Style.** Prettier and ESLint settle formatting. TypeScript strict mode everywhere.

## Commit messages

Imperative mood with an optional scope: `quota: refund runs when a job fails on our side`,
`web: keep the upload form across reloads`. Explain the *why* in the body when it is not
obvious.

## Architecture decisions

A change that alters a documented decision (single deployment, layering, providers and
keys, job processing, document rendering, the offline engine, uploads, quotas, logging,
native token mode, deployment topology) needs a new or updated ADR in
[docs/architecture/adr/](docs/architecture/adr/README.md) explaining the trade-off, linked
from the pull request.
