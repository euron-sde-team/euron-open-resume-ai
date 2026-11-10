# ADR 0006: A component table instead of per-feature status columns

## Status

Accepted.

## Context

One resume produces several results: an analysis and rewrite, interview questions in four tracks,
a roadmap and project ideas. They have different costs, take different time, fail independently
and can be generated later. The obvious schema is a status column per feature on the resume
(`analysis_status`, `roadmap_status`, ...), plus one overall status. That shape means a failed
roadmap flips the whole resume to an error state, a retry re-runs everything, new features need
a migration and a new column, and nobody can tell what was charged for what.

## Decision

- A resume is a set of **components**, one row each in `resume_components`, keyed by
  `(resume_id, kind)`, with `status` (`pending`, `processing`, `done`, `failed`, `skipped`),
  `claimed_at`, `attempts`, `charged`, `error` and `data` (JSONB, for the results that have no
  column of their own).
- A queue job runs one **job component**. `analysis` covers two rows (`analysis` and `rewrite`
  come out of one AI call). The registry in [`components.ts`](../../../apps/api/src/services/resume/components.ts)
  is the whole definition: which rows a job covers, its cost and its usage kind.
- The resume's overall `status` is **derived from the analysis and rewrite rows only** and stored
  for listing, so on-demand work never changes it.
- Every state change is a **conditional `UPDATE`** (`request`, `claim`, `release`, `markDone`,
  `fail`, `cancelQueued`, `reapStale`), which makes the pipeline idempotent without locks: a
  duplicate delivery, a second worker or a double click claims nothing.
- The charge lives on the component row (`charged`) so a failure refunds exactly what was taken.
- Job payloads carry ids only; the worker reads the content from the database and storage.
- Stale work is failed and refunded by a reaper that runs when someone reads the resume
  ([resume-pipeline.md](../resume-pipeline.md#6-stale-work)).

## Consequences

Positive:

- A failure is local. A failed roadmap shows a retry button on the roadmap and leaves the report
  untouched.
- Adding a component is a new enum value, a row in `COMPONENTS` and an executor. No new column.
- Retries, charges and refunds are per component and auditable from the row.
- The polling endpoint returns every component's state in one small response.

Trade-offs:

- State is spread over rows, so reading a resume joins (or queries) the components, and the
  overall status is a function you have to trust (`deriveStatus` is unit-tested).
- Results live in two places: the big ones in `resumes` columns, the small ones in
  `resume_components.data`.
- There is no scheduled sweep for stale rows; reaping on read can leave a crashed job pending
  until someone looks ([security.md](../security.md#known-gaps), gap 3).
- `skipped` is in the enum and the status logic but nothing sets it.

## Alternatives considered

- **A status column per feature on `resumes`.** The shape this replaces.
- **A single JSONB `state` column.** Flexible, but conditional claims across concurrent workers
  need row-level atomic updates, which a JSON blob makes awkward.
- **Only the queue's own state (BullMQ).** Lost on a Redis flush, invisible to the user, and
  unable to hold the charge.
