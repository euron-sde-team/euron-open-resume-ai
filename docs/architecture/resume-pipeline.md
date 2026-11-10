# The resume pipeline

How a resume goes from an upload to a finished report, and what keeps that safe when jobs
run twice, fail, crash or never start. The code is
[`services/resume/pipeline.ts`](../../apps/api/src/services/resume/pipeline.ts) (what a job
does), [`components.ts`](../../apps/api/src/services/resume/components.ts) (the registry and
the status function),
[`resume.service.ts`](../../apps/api/src/services/resume/resume.service.ts) (what an endpoint
does before and after the queue) and
[`resume-component.repository.ts`](../../apps/api/src/repositories/resume-component.repository.ts)
(every state change as a conditional `UPDATE`). The design decision is
[ADR 0006](adr/0006-component-table-pipeline.md). The sequence is drawn in
[HLD.md](HLD.md#5-the-analysis-pipeline-end-to-end).

## 1. Components

A resume is a set of **components**, each with its own row in `resume_components` and its own
state. A failure is local: a failed roadmap does not touch the analysis.

| Component kind | Produced by job | Result stored in | Cost when asked for | Charged to usage kind |
| --- | --- | --- | --- | --- |
| `analysis` | `analysis` | `resumes.analysis`, `resumes.score` | 1 run | `analyze` |
| `rewrite` | `analysis` (same job) | `resumes.improved`, `resumes.cover_letter` | covered by the analysis run | `analyze` |
| `interview_non_technical` | `interview_non_technical` | `resume_components.data` | free in the default pipeline, 1 run on demand | `interview` |
| `interview_dsa` | `interview_dsa` | `data` | 1 run | `interview` |
| `interview_programming` | `interview_programming` | `data` | 1 run | `interview` |
| `interview_system_design` | `interview_system_design` | `data` | 1 run | `interview` |
| `roadmap` | `roadmap` | `data` | 1 run | `roadmap` |
| `projects` | `projects` | `data` | 1 run | `projects` |

A queue **job** runs one *job component*. `analysis` is the only job that covers two rows
(`analysis` and `rewrite` come out of one AI call, so one failure fails both). `COMPONENTS` in
`components.ts` is the whole table; adding a component means adding a row there and an
executor in `pipeline.ts`.

The **default pipeline** is `analysis`, then `interview_non_technical`. When the analysis job
finishes, it requests the interview job at cost 0 and dispatches it. The other four
components are **on demand**: `POST /api/resumes/:id/components/:kind` with `kind` one of
`interview_non_technical`, `interview_dsa`, `interview_programming`,
`interview_system_design`, `roadmap`, `projects`. They need an analysed (or built) resume:
`409 NOT_READY` otherwise, and `409 ALREADY_RUNNING` when that component is already
`processing`.

The job payload is `{ resumeId, userId, component }`. It carries ids only; the worker reads
the resume from the database and the original file from storage
([`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)).

## 2. Statuses and the state machine

### Component status

| Status | Meaning |
| --- | --- |
| `pending` | Not generated (no row, or a queued row cancelled because its parent failed) |
| `processing` | Requested. `claimed_at IS NULL` means queued, not yet picked up; `claimed_at` set means a worker is running it |
| `done` | Finished; `data` or the resume columns hold the result |
| `failed` | Failed finally; `error` holds a message safe to show |
| `skipped` | Reserved. Treated as `done` by the status function; no code sets it |

Transitions, each a conditional `UPDATE` in the repository:

| From | To | Function | Condition |
| --- | --- | --- | --- |
| none, `pending`, `done`, `failed` | `processing` (unclaimed) | `request` | Insert, or upsert where the row is not `processing`, or has not been touched for 30 minutes. Returns false when it is already queued or running, so a double click cannot run or charge twice |
| `processing` (unclaimed or claim older than 10 min) | `processing` (claimed, `attempts + 1`) | `claim` | `status = 'processing' AND (claimed_at IS NULL OR claimed_at < now - 10 min)`; returns the attempt number or null |
| `processing` (claimed) | `processing` (unclaimed, `error` set) | `release` | A retryable failure with attempts left |
| `processing` | `done` | `markDone` | In the same transaction as the result |
| `processing` | `failed`, `charged = 0` | `fail` | Final failure; returns the runs that had been charged, for the caller to refund |
| `processing` (unclaimed) | `pending`, `charged = 0` | `cancelQueued` | The analysis failed, so its queued follow-ups never start |
| `processing` for over 30 minutes | `failed`, `charged = 0` | `reapStale` | Stale; see section 6 |

### Resume status

The resume's overall `status` (`queued`, `processing`, `analyzed`, `error`) is **derived from
the `analysis` and `rewrite` rows alone** and stored for listing (`deriveStatus`):

| Condition | Status |
| --- | --- |
| Either of `analysis`, `rewrite` is `failed` | `error` |
| Both are `done` or `skipped` | `analyzed` |
| One is `processing` and claimed | `processing` |
| Otherwise | `queued` |

So an on-demand interview or roadmap run never flips a finished resume back to `processing`,
and a failed roadmap never makes the resume `error`. The status is recomputed by `syncStatus`
after every change and is a no-op when nothing changed (no `updated_at` bump).

`GET /api/resumes/:id` returns every component's state (`pending` for kinds without a row) plus
the results; `GET /api/resumes/:id/status` returns only the states, which is what the web app
polls.

## 3. What an endpoint does before the queue

Creating, tailoring and queueing on-demand work all follow the same order. The order matters
because each step has an undo.

```
1. validate input, sniff and extract (uploads): nothing charged yet
2. assert the resume slot and that runs are left   (cheap pre-checks, clean 4xx)
3. chargeRuns   (atomic, advisory lock)            undo: refundRuns
4. storage.put  (the original file)                undo: storage.delete
5. transaction under a per-user advisory lock:
     re-check the slot, insert resume, request the component row(s), audit,
     fx.after(dispatch)                            (enqueue only after commit)
6. dispatch -> enqueue "resume-ai.run"             undo on failure: failJob (fail + refund)
```

Any exception between 3 and 5 refunds the run and deletes the stored file
(`startResume`). If the enqueue itself fails (Redis down), `dispatch` fails the component
with "We could not start this job" and refunds the run, so a charge is never left with no job
behind it.

`requestJob` gives the first row of a job the charge (`charged = cost`) and the others 0, so
a failure refunds exactly what was taken.

**Tailoring** (`POST /api/resumes/:id/tailor`) creates a new resume with `parent_id` set,
copies the original file (a new key) and the parsed `original`, and runs the analysis against
the new job description. It costs one run, and counts as one more resume against the slot cap.

**Builder resumes** (`POST /api/resumes/from-document`) skip extraction and parsing:
`original` is the builder document, and the analysis starts from it.

## 4. What a job does

`runResumeJob` validates the payload with zod, then loops `attempt()` (the loop matters only
in `JOBS_MODE=inline`; under BullMQ a retry is a thrown error that the queue redelivers with
backoff).

`attempt()`:

1. `claim` the job's first row. `null` means done, running elsewhere or gone: return
   `skipped`, do nothing. Otherwise `attempts` is incremented.
2. Load the resume with `findOwned(resumeId, userId)`; missing means `skipped`.
3. `touch` the other rows the job covers (so `rewrite` reads as claimed too) and `syncStatus`.
4. Build the run context: the job description and company from the resume row, and an
   `AbortSignal.timeout(180_000)` across the whole job.
5. Execute:
   - **`runAnalysis`**: if `original` is empty, read the file from storage, `sniffFile`,
     `extractText`, `parseDocument`; refuse an empty parse; store `original`. Then
     `analyze(original, job)`. Normalise `improved`, refuse an empty rewrite (retryable),
     clamp the score to 0..100, and write `improved`, `analysis`, `cover_letter` and `score`
     plus `markDone` for both rows plus `syncStatus` in **one transaction**.
   - **`runComponent`**: pick `improved ?? original` (a non-retryable `PipelineError` "Analyse
     this resume first" when there is none), call the interview, roadmap or projects task,
     refuse an empty list (retryable), and `markDone` with the data plus `syncStatus` in one
     transaction.
6. On success of `analysis`, request the default follow-up (`interview_non_technical`) at cost
   0 and dispatch it.

### Errors and retries

| Error | Retryable | Message to the user |
| --- | --- | --- |
| `PipelineError(message, retryable)` | per flag | the message |
| `ExtractError` (unsupported, unreadable, no text) | never | the message |
| `AiBadOutput` (two invalid answers) | yes | "The AI step did not finish. Please retry in a moment." (generic) |
| `AiUnavailable` (provider down, rate limited, timeout) | yes | generic (a raw `AbortError` or `TimeoutError` gets "The AI service took too long to answer. Please retry.") |
| Anything else | yes | generic |

A retryable error with `attempts < MAX_ATTEMPTS` (3) `release`s the row (clears the claim,
keeps the error text) and returns `retry`; BullMQ redelivers after 10 s, then 20 s
(exponential). The attempt count in the database and BullMQ's attempt count therefore agree.
The final failure calls `failJob`.

`failJob` runs in one transaction: `fail` the covered rows (summing their `charged`), cancel
the queued follow-ups if the analysis failed, `syncStatus`. After the commit it calls
`refundRuns` for the charged runs. A refund that itself fails is logged, not thrown.

User-facing messages never contain model text or provider detail
([`userMessage`](../../apps/api/src/services/resume/pipeline.ts)); the real error is logged
with ids only.

## 5. Retry and re-run by the user

`POST /api/resumes/:id/retry` takes an optional `component`. It reaps stale work first, then
retries only components that are `failed` (`409 NOT_FAILED`, `NOTHING_TO_RETRY`). When the
analysis failed it retries only the analysis (the other components work from the analysed
resume, and the follow-up is requested again by the analysis itself). Each job retried costs
one run, charged through the same `chargeJobs` (all or nothing: if a later charge is refused,
the earlier ones are refunded). If a job turns out to be running already, its run is
refunded and the call is `409 ALREADY_RUNNING`.

## 6. Stale work

| Constant | Value | Purpose |
| --- | --- | --- |
| `MAX_ATTEMPTS` | 3 | Worker attempts per request |
| `STALE_CLAIM_MS` | 10 minutes | A claim older than this is a crashed worker, and `claim` may take the job again |
| `STALE_REQUEST_MS` | 30 minutes | A component `processing` for longer than this lost its job; it is failed and refunded |

There is no scheduled sweep for stale components. The **reaper** runs on demand: `get`,
`status`, `retry` and `generateComponent` call `reap(resume)` first. It selects stale
`processing` rows, then fails them with a second conditional `UPDATE` (so two readers reaping
at once refund once) and refunds each row's `charged` runs. Reaping happens for a resume
only when someone reads that resume, which the web app does by polling while the page is open.

**A crashed worker.** A worker that dies mid-job leaves the row claimed. BullMQ's stalled-job
check redelivers the job after its lock lapses (about 30 s by default), but `claim` refuses
any claim younger than 10 minutes, so the redelivered attempt reports `skipped` and the job
completes without doing the work. After that, only the reaper (at 30 minutes, on read) or a
user retry moves the component. `STALE_CLAIM_MS` helps only when a delivery happens after
the 10 minutes have passed. This is a known gap ([security.md](security.md#known-gaps) lists
it with the others).

## 7. Idempotency

| Hazard | Guard |
| --- | --- |
| Double click on upload or retry | `request` upsert returns false for a row already `processing` (and fresh); the run is refunded |
| Duplicate job delivery | `claim` is a conditional `UPDATE`; only one caller gets the row |
| Two workers on one job | Same `claim`; the loser returns `skipped` |
| A job that finished, redelivered | `claim` needs `status = 'processing'`; a `done` row is not claimable |
| Result written twice | Results, `markDone` and `syncStatus` share one transaction |
| Two readers reaping | The failing `UPDATE` repeats the `status` and `updated_at` conditions; the refund follows only the rows it actually changed |
| Parallel uploads past the slot cap | A per-user advisory lock `resume-slot:<user>` around the re-check and the insert |
| Parallel charges past the monthly limit | A per-user advisory lock `quota:<user>` inside `chargeRuns` ([quotas.md](quotas.md#3-charging-atomically)) |
| Enqueue for a rolled-back insert | `fx.after` runs only after commit |

## 8. Deleting and account purge

`DELETE /api/resumes/:id` deletes the row (components cascade) in a transaction, audits it and
removes the stored file after the commit, so a rolled-back delete never loses the file.
Deleting a resume that has tailored copies sets their `parent_id` to null. Jobs for a
deleted resume find no row and report `skipped`. The account purge deletes all of a user's
resumes and files the same way.

## 9. The seams for tests

`aiTasks()` and `resumeRendererDep()` in
[`deps.ts`](../../apps/api/src/services/resume/deps.ts) can be replaced with
`setResumeDeps`. The integration suite runs the whole pipeline with `JOBS_MODE=inline`
against the in-process stub, and unit tests cover `deriveStatus` and the component helpers
([`resume-components.test.ts`](../../apps/api/test/unit/resume-components.test.ts)).
