# ADR 0002: A deterministic offline engine is the default AI

## Status

Accepted.

## Context

The product's value is a set of AI tasks over a resume: parse, analyse, rewrite, cover letter,
interview questions, roadmap, project ideas, and a chat builder. Calling a hosted model needs
a key, costs money per run and sends resume text to a third party. A self-hosted deployment
should be usable the moment it starts, without an account at a model vendor, and a person who
evaluates it should see every feature work. At the same time, an operator who does configure a
model expects it to be used and expects real provider problems to be visible.

## Decision

- Every task goes through one contract ([`ai-tasks.ts`](../../../apps/api/src/services/resume/ai-tasks.ts)).
  The implementation resolves the admin-configured text model once per task
  ([`models.service.ts`](../../../apps/api/src/services/models.service.ts)). With a usable
  model it runs the structured-output runner; with none it runs the **offline engine**
  ([`ai/offline/`](../../../apps/api/src/services/resume/ai/offline/index.ts)).
- The offline engine is a set of pure, deterministic functions: a heuristic parser, an ATS-style
  score computed from counted signals (contact 15, sections 20, bullets 20, action verbs 10,
  quantified results 15, keywords 15, readability 5), a bullet improver that rewrites filler
  openers but never touches numbers, employers, titles or dates, templated interview questions
  filled with the candidate's own terms, a skills-gap roadmap and project ideas, and a chat
  builder that merges what the user typed. It invents nothing.
- A model is *usable* when it and its provider are enabled and the provider has a key in the
  environment (or needs none: the stub, a local OpenAI-compatible server).
- **A configured model that fails is an error, not a silent downgrade.** The job retries and
  then fails the component with a generic message and refunds the run. Falling back quietly to
  a weaker engine would hide a broken key from the admin and give users worse results without
  saying so.
- The same prompts, schemas and pipeline run in both modes, and a deterministic OpenAI-compatible
  stub ([`apps/stubs`](../../../apps/stubs/server.mjs)) exercises the real provider path in
  tests and in `make demo` with no key.
- Admins see which mode is active: `GET /api/admin/integrations` reports
  `ai.providerConfigured`.

## Consequences

Positive:

- A fresh install works end to end with no key and no cost, and nothing leaves the deployment
  until an operator decides to send it.
- Tests and demos are deterministic and free.
- The offline score is explainable: every point traces to something counted in the document.
- Provider problems surface as failures instead of quietly worse output.

Trade-offs:

- The offline engine is English-only and heuristic. Parsing depends on layout, rewriting is a
  tightening, the builder chat does not understand free prose about a job, and interview
  content is templated ([ai-engine.md](../ai-engine.md#honest-limits)).
- Two code paths per task to maintain and keep behaviourally aligned
  ([`stub-contract.test.ts`](../../../apps/api/test/unit/resume-ai/stub-contract.test.ts) and the
  schema tests guard the shared contract).
- Members are not told which engine produced their result.
- There is no automatic fallback to the offline engine when a provider is down. That is
  deliberate, and it means an outage fails jobs until the provider recovers or an admin disables it.

## Alternatives considered

- **Require a provider key.** The simplest code, and the worst first run: nothing works until
  you sign up with a vendor. It also removes the no-egress option for sensitive deployments.
- **Fall back to the offline engine on provider errors.** Keeps the product answering, but
  hides failures and mixes two quality levels in one user's history.
- **Ship a local model.** Heavy to run, hard to keep deterministic and not available on small
  instances. A local OpenAI-compatible server (Ollama, vLLM) is supported as a provider instead.
