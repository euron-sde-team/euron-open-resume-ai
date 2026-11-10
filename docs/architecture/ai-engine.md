# The AI engine

Every AI task goes through one seam, runs against an admin-configured model when there is one
and against a deterministic offline engine when there is not, and is validated the same way
either way. Code: [`services/resume/ai-tasks.ts`](../../apps/api/src/services/resume/ai-tasks.ts)
(the contract), [`services/resume/ai/`](../../apps/api/src/services/resume/ai/index.ts) (the
implementation), [`services/models.service.ts`](../../apps/api/src/services/models.service.ts)
(which model),
[`integrations/llm/`](../../apps/api/src/integrations/llm/index.ts) (provider adapters). The
decisions are [ADR 0002](adr/0002-offline-engine-as-default-ai.md) and
[ADR 0005](adr/0005-canonical-resume-document.md).

## 1. Provider resolution

An admin manages two tables in `/admin`: `providers` (an endpoint: kind, display name, base
URL, enabled) and `models` (a provider's model id, context window, output cap, enabled,
default, sort order). The runtime reads them through `resolveTextModel`.

A model is **usable** only when all of these hold:

| Condition | Where |
| --- | --- |
| `models.enabled` and `providers.enabled` | the join in `usableRows` |
| the provider has a base URL: its own, or the kind's default (`https://api.openai.com/v1`, `https://api.anthropic.com`, `https://generativelanguage.googleapis.com/v1beta`, `$STUBS_URL/v1`); an `OPENAI_COMPATIBLE` provider must set one | `endpointFor`, `defaultBaseUrl` |
| a key exists for the provider slug in `PROVIDER_KEYS` (or one of the single-key shortcuts `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` for the slugs `openai`, `anthropic`, `gemini`, `openrouter`, `groq`), unless the kind needs none (`STUB`, `OPENAI_COMPATIBLE`, for a local Ollama or vLLM) | `endpointFor`, `providerKeys` |

`resolveTextModel(requested?)` returns the requested model if usable, else the model flagged
`is_default`, else the first usable one by `sort_order` and name, else `null`. The list is
cached for 5 seconds per process. `null` means "run offline". No caller passes a requested
model today, so the deployment default (or the first usable model) is always used; the
comment in the migration about pinning a model per task describes something that is not
implemented.

Keys are read from the environment on every resolution. They are never part of a row, a DTO,
a log line or an API response. `GET /api/admin/providers` reports only `keyConfigured`.
Placeholders (`set-me`, empty) count as not configured, and a malformed `PROVIDER_KEYS` is
ignored without echoing it.

A first install seeds `openai`, `anthropic` and `gemini` with a few models each
([`demo/catalog.ts`](../../apps/api/src/demo/catalog.ts)). Until a key is set none of them is
usable, and the offline engine answers. Model ids change often: edit them in `/admin/models`
and use the **Test** button, which makes one 16-token call and reports a short, key-free
message (`The provider rejected the key.`, `check the model id.`, and so on).

**A configured model that fails is an error, not a silent downgrade.** The task throws
`AiUnavailable` or `AiBadOutput`, the pipeline retries and finally fails the component with
a generic message and refunds the run. The offline engine is used when no model is *usable*,
not when one is broken, so an admin sees real provider problems.

## 2. Adapters

One interface, `LlmAdapter.stream(request, endpoint)`, yields `text`, `usage` and `finish`
events ([`integrations/llm/types.ts`](../../apps/api/src/integrations/llm/types.ts)). Resume
tasks collect the whole answer with `completeText`.

| Kind | Wire format | JSON mode | Auth header |
| --- | --- | --- | --- |
| `OPENAI` | Chat Completions, `max_completion_tokens` | `response_format: json_object` | `Authorization: Bearer` |
| `OPENAI_COMPATIBLE`, `STUB` | Chat Completions, `max_tokens` | `response_format: json_object` | `Authorization: Bearer` (omitted without a key) |
| `ANTHROPIC` | Messages API, system prompt as a top-level field | none; steered by the prompt | `x-api-key` and `anthropic-version` |
| `GEMINI` | `streamGenerateContent?alt=sse` | `responseMimeType: application/json` | `x-goog-api-key` |

All adapters use plain `fetch` ([`integrations/http.ts`](../../apps/api/src/integrations/http.ts))
with a 180 s timeout combined with the caller's abort signal. A non-2xx response becomes a
`ProviderError` with a stable failure class (`AUTH`, `RATE_LIMITED`, `CONTEXT_TOO_LONG`,
`BAD_REQUEST`, `CONTENT_FILTER`, `UNAVAILABLE`, `TIMEOUT`). The response body is logged
truncated to 600 characters with key-shaped strings masked, and never returned to a user.

## 3. The structured-output runner

[`ai/runner.ts`](../../apps/api/src/services/resume/ai/runner.ts) `runStructured(schema,
prompt, run)`:

1. Resolve the model (once per task, passed in by the caller).
2. Build a system message and one user message; cap the output tokens at the smaller of the
   prompt's budget and the model's `max_output_tokens` (at least 512).
3. Call the model with `json: true`, temperature 0.3.
4. Extract a JSON object from the answer: the text as is, a fenced block, or the first
   balanced `{...}` in surrounding prose (`extractJson`, string and escape aware).
5. Validate with the task's zod schema ([`ai/schemas.ts`](../../apps/api/src/services/resume/ai/schemas.ts)).
6. On failure, **one repair retry**: append the model's answer and a message listing up to 12
   validation errors (or "your answer was cut off" when `finish` is `length`), ask again at
   temperature 0.1.
7. A second failure throws `AiBadOutput`.

Token usage (`inputTokens`, `outputTokens`, `calls`) is accumulated per task for the log line
only; nothing about it is stored per resume.

### Timeouts and cancellation

| Limit | Value |
| --- | --- |
| Per `runStructured` call, across both attempts | 120 s (`TIMEOUT_MS.default`), 90 s for the builder chat |
| A whole resume job | 180 s `AbortSignal.timeout` in the pipeline context |
| Per HTTP request to a provider | 180 s in the adapter |
| The builder chat and import endpoints | Aborted when the client disconnects (`res.on("close")`) |

`raceAbort` settles when the signal fires even if an adapter ignores it.

### Error mapping

| Cause | Error | Message shown |
| --- | --- | --- |
| No model configured when one is required | `AiUnavailable` | "No AI model is configured." |
| Timeout | `AiUnavailable` | "The AI took too long to answer. Please try again." |
| Client cancelled | `AiUnavailable` | "The request was cancelled." |
| `CONTEXT_TOO_LONG` | `AiUnavailable` | "This resume is too long for the AI model. Shorten it and try again." |
| `RATE_LIMITED` | `AiUnavailable` | "The AI service is busy right now. Please try again in a minute." |
| Any other provider failure | `AiUnavailable` | "The AI service is not available right now. Please try again in a moment." |
| Two invalid answers | `AiBadOutput` | "The AI returned an answer we could not use. Please try again." |

The builder endpoints turn them into HTTP errors: `AiUnavailable` is 503 `AI_UNAVAILABLE` and
`AiBadOutput` is 502 `AI_BAD_OUTPUT`. In the pipeline both become a retry and, finally, a
generic component error.

## 4. The tasks

[`ai/index.ts`](../../apps/api/src/services/resume/ai/index.ts) implements `ResumeAiTasks`.
Every task first resolves the model once (`begin`), runs either the model path or the offline
path, and logs one line with the task name, user id, `offline`, token counts and call count
(`finish`). It logs no text.

| Task | Model path | Offline path |
| --- | --- | --- |
| `parseDocument(text)` | `parse` prompt, `{ document }` | `parseResumeText` |
| `analyze(document, job)` | `analysis` and `rewrite` prompts in parallel, then `analysis_after` on the rewrite given the first report | `analyzeOffline` before, `improveDocument`, `analyzeOffline` after, `coverLetterOffline` |
| `interview(track, ...)` | `interview_<track>` prompt, `{ groups }` | `interviewOffline` |
| `roadmap(...)` | `roadmap` prompt | `roadmapOffline` |
| `projects(...)` | `projects` prompt, `{ projects }` | `projectsOffline` |
| `builderChat(req)` | `chat` prompt, 90 s | `chatOffline` |

After a model rewrite, `restoreOwnerFields` copies the owner's name, email, phone, location,
links and photo from the original over whatever the model returned, and `fillMissingSections`
takes sections the model dropped from the original. So a rewrite cannot change who the resume
belongs to, and the photo never passes through a model.

Inputs are capped before they reach either path
([`ai/limits.ts`](../../apps/api/src/services/resume/ai/limits.ts)): resume text 30,000
characters, job description 8,000 (the database allows 20,000, the model sees at most 8,000),
company 120, builder chat 30 messages of 8,000 characters.

## 5. Prompt hardening

[`ai/prompts.ts`](../../apps/api/src/services/resume/ai/prompts.ts):

- Every system prompt starts with a marker line `[task:<name>]`, which the stub uses to choose
  its canned answer and which makes logs and tests readable.
- **Untrusted blocks.** Resume text, the job description, the company and chat messages are
  wrapped in `<untrusted_resume>`, `<untrusted_job_description>` and similar tags
  (`untrusted()` in `limits.ts`). `defang` replaces any `<untrusted...>` or `</untrusted...>`
  inside the text with `[removed]`, so user text cannot close or spoof a block.
- The shared `DATA_RULES` block tells the model that text inside those blocks is data, never
  instructions, including requests to reveal the rules, change the output format or score
  higher, and that the answer is one JSON object and nothing else.
- The shared `TRUTH_RULES` block forbids inventing employers, titles, dates, degrees, skills,
  tools or numbers; the prompts are location and currency neutral and keep the resume's
  language.
- The output contract is a zod schema, so an injected instruction that makes the model answer
  in prose, or with a different shape, is rejected, not rendered.
- Model output is rendered only through the escaped templates and the DOCX builder
  ([rendering-and-templates.md](rendering-and-templates.md)), and links in it pass `safeHref`.
- Chat messages from the browser reach the model only inside untrusted blocks, capped.

**What this does not guarantee.** Prompt injection is mitigated, not solved. A hostile resume
can still bias its own score or ask for its own rewrite; the damage is bounded to that user's
own resume, because the model has no tools, no network and no access to other users' data. See
[threat-model.md](threat-model.md).

The `systemPromptAddendum` setting that `/admin/settings` shows ("added to every AI request")
is stored and merged into the settings document but is not read by any prompt builder. It has
no effect today ([security.md](security.md#known-gaps)).

## 6. The offline engine

[`ai/offline/`](../../apps/api/src/services/resume/ai/offline/index.ts) is a set of pure,
deterministic functions: no network, no randomness, no model. It is what a fresh install runs,
and it is a real product path, not a mock: the same inputs give the same outputs, every number
in a report comes from something counted in the document, and nothing is invented.

| Capability | File | What it does |
| --- | --- | --- |
| Parse | `parse.ts` | Reads the plain-text layout `documentToText` writes and the usual layouts of real resumes: section headings in any case, `A \| B \| C \| dates` or `Title at Company (dates)` entry lines, `-` and bullet-character bullets, `Category: a, b` skill lines. A field it cannot place is left out |
| Score | `score.ts` | 100 points from counted signals: contact 15, sections 20, bullets 20 (count and length), action verbs 10, quantified results 15, keywords 15 (overlap with the job description's keywords, or breadth of skills when none is given), readability 5. The report names the measurements it used |
| Improve | `improve.ts` | Rewrites filler openers ("Responsible for managing X" to "Managed X"), strips filler words, fixes capitalisation and duplicates, writes a summary from the facts when there is none, and puts the skills a job description asks for first. Numbers, employers, titles and dates are never touched |
| Cover letter | `letter.ts` | Built from the document, the company and the job description, using the candidate's own bullets verbatim |
| Interview | `interview.ts` | Templated per track (non-technical, DSA, programming, system design), filled with the candidate's own roles, skills and bullets. Answers are model answers or guidance on how to answer; they never claim an achievement the resume does not hold |
| Roadmap, projects | `growth.ts` | Derived from the skills gap: the job description's keywords the resume lacks, or the natural next skills for what it already lists. No salaries, currencies or market claims |
| Builder chat | `chat.ts` | Merges what the user typed into the current document and asks for the next missing piece. Understands pasted resumes (through the parser), contact details and links anywhere in a message, "my name is ...", and `skills: ...` lines |

### Honest limits

| Limit | Consequence |
| --- | --- |
| English only. The action-verb list, filler patterns, stop words and templates are English | A resume in another language gets a low verb and keyword score and no useful rewrite. A model reads other languages; the offline engine does not |
| The parser is heuristic. Two-column PDFs interleave their columns before the text reaches it, and free-form prose with no headings yields a header plus whatever labelled lines exist | Parse quality depends on the layout; a model parse is better on unusual resumes |
| It improves wording, it cannot add substance | If a bullet has no impact, the report says what to add; it will not make one up. The rewrite is a tightening, not a rewrite |
| The builder chat does not understand free prose about a job ("I worked at X for three years") | It says what it still needs instead of guessing |
| Keyword extraction is word-list based, not semantic | Synonyms and related skills are not matched |
| Interview content is templated | Questions are reasonable and personalised with the resume's terms, but they are not as specific as a model's |
| The score is a heuristic ATS proxy, not a real ATS | It measures signals an ATS or a recruiter tends to care about. It is not a prediction of any specific system |

Members are not told which engine produced a result. Admins see it: `GET /api/admin/integrations`
reports `ai.providerConfigured`, and the admin settings page shows "None: the offline engine
answers" when it is false.

## 7. The stub

[`apps/stubs/server.mjs`](../../apps/stubs/server.mjs) is a dependency-free Node server that
speaks the OpenAI Chat Completions wire format on port 5199 (`POST /v1/chat/completions`,
streaming and not, with usage; `GET /v1/models`). When the first system message starts with
`[task:<name>]` it answers that task's canned JSON, so the API's real adapter, runner,
validation, retry and pipeline code run end to end with no key and no cost. Other words steer
failures: `fail` answers 500, `ratelimit` 429, `context overflow` 400. `GET /__/requests`
lists what the API sent (bodies, and whether a key was present); keys are never checked.

Providers of kind `STUB` call `$STUBS_URL/v1`. The stub is never deployed to AWS; the starter
catalogue lists it (disabled) only through `demo:seed` outside production. The integration
suite starts it in-process on an ephemeral port, and
[`stub-contract.test.ts`](../../apps/api/test/unit/resume-ai/stub-contract.test.ts) keeps its
answers in line with the schemas.

## 8. What is logged

One line per task: task name, user id, `offline`, input and output token counts, call count.
On a rejected structured answer: task, attempt number and finish reason. On a provider error:
provider slug, failure class and HTTP status. The logger also redacts the field names
`document`, `jd`, `text`, `original`, `improved`, `coverLetter`, `photoDataUrl`, `content`,
`prompt`, `messages` and `input` at up to three levels of nesting
([`core/logger.ts`](../../apps/api/src/core/logger.ts)). Resume text, job descriptions and
prompts never reach a log line.
