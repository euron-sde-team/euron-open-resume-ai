# Connect real providers

Everything the app does with AI works with no provider at all, on the built-in offline
engine. This guide shows how to add a real model (OpenAI, Anthropic, Gemini, OpenRouter,
Groq, a local Ollama or any OpenAI-compatible endpoint), how to test it, what happens when
it is missing or fails, and how to set up the other external services: S3, SES and SMTP.

## The model in one picture

A **provider** is an entry in the `providers` table: a slug (its id), a kind, an optional
base URL. A **model** belongs to a provider and names the model id the provider's API
understands. Both are edited in `/admin/models` and stored in the database. The **API key
is never stored there**: it lives in the server environment under the provider's slug.

| Part | Where | Example |
| --- | --- | --- |
| Provider slug | `/admin/models`, lowercase letters, digits and hyphens, 3 to 40 characters | `openai` |
| Provider kind | `OPENAI`, `ANTHROPIC`, `GEMINI`, `OPENAI_COMPATIBLE`, `STUB` | `OPENAI` |
| Base URL | Provider form. Empty uses the kind's default | `http://host.docker.internal:11434/v1` |
| Key | `PROVIDER_KEYS` (JSON keyed by slug) or a shortcut variable | `{"openai":"<key>"}` |
| Model id (`modelRef`) | Model form | `gpt-5.4-mini` |

A model is offered only when it is enabled, its provider is enabled, and the provider is
usable: it has a key under its slug, or it is a kind that needs none (`STUB`, and
`OPENAI_COMPATIBLE`, whose server may be keyless like a local Ollama). The catalogue is
cached for 5 seconds per process.

Default endpoints when the base URL is empty
([`integrations/llm/index.ts`](../../apps/api/src/integrations/llm/index.ts)):

| Kind | Default base URL | Wire format |
| --- | --- | --- |
| `OPENAI` | `https://api.openai.com/v1` | Chat Completions, JSON mode, `max_completion_tokens` |
| `ANTHROPIC` | `https://api.anthropic.com` | Messages API |
| `GEMINI` | `https://generativelanguage.googleapis.com/v1beta` | `streamGenerateContent`, `application/json` response type |
| `OPENAI_COMPATIBLE` | none: required | Chat Completions, JSON mode, `max_tokens` |
| `STUB` | `$STUBS_URL/v1` | Chat Completions; development only (`STUB_IN_PRODUCTION` in production) |

## Add a provider with the key in the environment

The starter catalogue (`openai`, `anthropic`, `gemini`, each with a few models) is created
on the first boot of an empty database, so the quickest path is to add the key:

**Locally.** In `deploy/compose/.env`:

```bash
PROVIDER_KEYS={"openai":"<openai-key>","anthropic":"<anthropic-key>"}
# or one provider with its shortcut:
OPENAI_API_KEY=<openai-key>
```

Then `make up` again; compose recreates the API and worker with the new environment. The
shortcuts exist for `openai`, `anthropic`, `gemini`, `openrouter` and `groq` only; any other
slug goes in `PROVIDER_KEYS`. `PROVIDER_KEYS` wins when both name the same slug.

**On AWS.** Put the keys in the secret Terraform created, then roll the API and worker
([deploy-aws.md](deploy-aws.md#provider-keys)):

```bash
aws secretsmanager put-secret-value --secret-id <name_prefix>/provider-keys \
  --secret-string '{"openai":"<openai-key>","anthropic":"<anthropic-key>"}'
```

The slug names must match the providers you create in `/admin/models`. A value of `set-me`
or an empty string counts as not configured.

## Admin steps (`/admin/models`)

1. **Open** `/admin/models` as an administrator. The **Providers** card lists each provider
   with whether a key is configured (`keyConfigured`; never the key).
2. **Add a provider** (skip this for the three starters). Choose the kind, give it a slug
   that equals the key's name in `PROVIDER_KEYS`, a display name and, for
   `OPENAI_COMPATIBLE`, the base URL ending where the API's `/chat/completions` path starts
   (usually `.../v1`). The URL must be `http` or `https`.
3. **Add a model.** Provider, model id exactly as the provider spells it, display name,
   context window, max output tokens, enabled, and **default**. Only one text model is the
   default; saving a new default clears the old one. Model ids change often: the starter
   ids are examples, so edit them if a provider has moved on.
4. Press **Test**. It makes one tiny real call ("reply with the single word: ok") and
   shows the latency and one of these messages:

| Message | Meaning |
| --- | --- |
| The model answered. | Works |
| No key is configured for this provider on the server. | The key is missing under that slug, or the provider kind needs one |
| The provider rejected the key. | 401 or 403: wrong, revoked or unfunded key |
| The provider is rate limiting this key. | 429 |
| The provider refused the request: check the model id. | 400: usually a wrong `modelRef` |
| The provider did not answer in time. | Timeout |
| The provider could not be reached or had an error. | Network, DNS, wrong base URL, or a 5xx |

The result never contains the key or the provider's own error text; that stays in the API
log (`provider call failed`, truncated, key-shaped strings masked).

## Recipes

| Provider | Kind | Slug | Base URL | Key |
| --- | --- | --- | --- | --- |
| OpenAI | `OPENAI` | `openai` | empty | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC` | `anthropic` | empty | `ANTHROPIC_API_KEY` |
| Google Gemini | `GEMINI` | `gemini` | empty | `GEMINI_API_KEY` |
| OpenRouter | `OPENAI_COMPATIBLE` | `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| Groq | `OPENAI_COMPATIBLE` | `groq` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| Ollama on the host | `OPENAI_COMPATIBLE` | `ollama` | `http://host.docker.internal:11434/v1` | none |
| Any other OpenAI-style server | `OPENAI_COMPATIBLE` | your choice | its `/v1` URL | `PROVIDER_KEYS` entry under the slug, if it needs one |

In the compose stack the `api` and `worker` containers map `host.docker.internal` to the
host, on Linux too. Inside a container `localhost` is the container itself.

The task needs a model that follows JSON instructions well. Small local models may often
return answers the app rejects (see below); try a larger one, or raise its max output
tokens.

## What the AI does, and what happens without it

There is one switch: **is there a usable enabled TEXT model?** If yes, every task goes to
the default model. If no, every task runs on the offline engine
([`services/resume/ai/offline/`](../../apps/api/src/services/resume/ai/offline)). A model
that is configured and **fails** is an error, never a silent downgrade to the offline
engine, so you see real provider problems.

| Task | With a model | Offline engine |
| --- | --- | --- |
| Parse the extracted text into a structured resume | 1 structured call | Heuristic parser: section headings, entry lines, bullets, skill lines. Nothing is invented; two-column PDFs can interleave |
| Analyse + improve + cover letter | 3 structured calls: analysis of the original, a rewrite with the cover letter, analysis of the rewrite | A score out of 100 from counted signals (contact, sections, bullets, action verbs, quantified results, keywords against the job description, readability); an improver that tightens wording without touching numbers, employers, titles or dates; a cover letter built from your own bullets |
| Interview questions (4 tracks) | 1 structured call per track | Templated questions and guidance per track, filled with your roles, skills and bullets |
| Roadmap, project ideas | 1 call each | Derived from the skills gap against the job description, or the usual next skills |
| Chat builder | 1 call per message | Merges what you typed (pasted resumes, contact details, links, `skills: ...` lines) and asks for the next missing piece; it does not understand free prose about a job |

Behaviour with a model:

- The answer must be one JSON object that validates against the task's schema. If it does
  not, the runner asks once more with the validation errors; a second failure is
  `AI_BAD_OUTPUT` (502).
- Each call has a timeout (120 s, 90 s for chat). A timeout, a provider error or a rate
  limit becomes `AI_UNAVAILABLE` (503) in the builder; in the resume pipeline the job is
  retried by BullMQ (3 attempts, exponential backoff from 10 s) and the component is then
  marked `failed` with a safe message, and the charged run is refunded.
- Resume text, job description, company and chat messages go to the model only inside
  `<untrusted_*>` blocks that the system prompt declares to be data, capped in size (30,000
  characters of resume, 8,000 of job description), after stripping anything that could close
  a block. Prompts forbid inventing employers, titles, dates or numbers; the owner's contact
  details and photo are restored after a rewrite.
- The admin "House instructions" setting is added to the system prompt of every task.
- Token totals and call counts are logged per task (`resume ai task done`), with no text.

The offline engine is deterministic: the same input gives the same output. That is what makes
the demo, the tests and a keyless install predictable. It is not a language model; its
writing is plainer, which is the honest reason to add a real provider.

## S3

Set `STORAGE=s3` and `S3_BUCKET` (and `S3_REGION` if it differs from `AWS_REGION`). The
API and worker use the default AWS credential chain; the task role in ECS needs
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on the bucket (and `kms:Decrypt`,
`kms:GenerateDataKey` if the bucket uses a customer-managed key). Terraform creates the
bucket (private, Block Public Access, SSE-KMS, versioning), its CORS rule and the task
permissions ([`modules/storage`](../../infra/terraform/modules/storage/main.tf)). Uploads
arrive at the API as multipart requests and are written server-side, so the browser never
talks to S3 in the resume flows. Any S3-compatible store works with
`AWS_ENDPOINT_URL`, which is how the Floci emulator is used locally.

## SES

Set `MAIL_MODE=ses`, `SES_REGION` (or `AWS_REGION`), `MAIL_FROM` (`Name <address>` on a
verified identity) and, optionally, `SES_CONFIGURATION_SET`. The task role needs
`ses:SendEmail`. Terraform creates the sending-domain identity with DKIM and a
configuration set ([`modules/email`](../../infra/terraform/modules/email/main.tf)) and
outputs the DNS records in `mail_dns_records`; add them where your DNS lives. A new SES
account is in the **sandbox**: it can send only to verified recipients until you request
production access. Until then, the first administrator's set-password link
(`make aws-admin`) can only go to a verified address.

## SMTP

For any other mail service:

```bash
MAIL_MODE=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=<user>
SMTP_PASS=<password>
MAIL_FROM="Euron Open Resume AI <no-reply@example.com>"
```

On AWS pass `SMTP_USER` and `SMTP_PASS` as ECS secret references with `api_extra_secrets`
in `terraform.tfvars` (see [deploy-aws.md](deploy-aws.md#configure)), never as plain
`api_extra_environment`. Locally Mailpit takes mail on `localhost:1106` (SMTP) and shows it
on `localhost:8106`. With `MAIL_MODE=outbox` (the default outside compose) messages are
written as `.eml` files under `DATA_DIR/outbox` and never sent; the production guard
refuses that mode.

## Next

- Every variable: [configuration.md](configuration.md).
- How the engine and the provider path are designed: [ai-engine.md](../architecture/ai-engine.md).
- Quota and cost control: [operations.md](operations.md#quotas-administration).
