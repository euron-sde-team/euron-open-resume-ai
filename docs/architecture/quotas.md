# Quotas

Every AI run costs the operator money at a model provider, or CPU on the offline engine. A
deployment for a team or a community needs to stop one person (or one stolen session) from
using the month's budget in an afternoon, and to give some people more than others. Quotas
here are monthly AI runs, a resume count and an upload size, set by admin-managed tiers with
a per-user override. There is no billing ([ADR 0003](adr/0003-admin-quotas-without-billing.md)).
Code: [`services/quota.service.ts`](../../apps/api/src/services/quota.service.ts).

## 1. What is limited

| Limit | Column | Unit | Default tier | Enforced in |
| --- | --- | --- | --- | --- |
| Monthly AI runs | `monthly_runs` | runs per UTC calendar month, all kinds together | 20 | `assertRunsLeft` (pre-check), `chargeRuns` (authority) |
| Resumes held | `max_resumes` | rows in `resumes` for the user, tailored copies included | 10 | `assertResumeSlot`, re-checked under a lock at insert |
| Upload size | `max_upload_mb` | megabytes, 1 to 500 in the schema, never above 10 MB in the API | 10 | `uploadLimitBytes` for `POST /api/resumes` |

`NULL` means unlimited. A user with `monthly_runs = NULL` has no run limit; the 10 MB
`MAX_UPLOAD_BYTES` ceiling applies regardless of the tier. Drafts have their own fixed cap of
50 per user and cost nothing.

## 2. Where the numbers come from

```
effective[field] = override[field]  if the user has an override row and it is not NULL
                 = tier[field]      if the user is on a tier
                 = default[field]   otherwise (the tier flagged is_default)
```

`limitsFor` resolves this in one query (user, their tier, the default tier and the override),
field by field.

- **Tiers.** Admins create as many as they like (`Default`, `Staff`, `Research`). Exactly
  one is the default, enforced by the partial unique index `quota_tiers_one_default` and by
  the service (`TIER_DEFAULT_REQUIRED`, and `TIER_IS_DEFAULT` when deleting it). A user with no
  tier uses the default. Deleting a tier moves its users to the default
  (`users.quota_tier_id` is `ON DELETE SET NULL`).
- **Overrides.** `user_quota_overrides` holds one user's own numbers. A `NULL` field in an
  override **falls back to the tier**; it does not mean unlimited. So an override can raise or
  lower a limit but cannot remove one: to make a user unlimited, put them on a tier whose
  value is `NULL`. The note and `updated_by` record why. Removing the override restores the
  tier's numbers.
- **Unknown user.** `limitsFor` returns 0 runs, 0 resumes and 1 MB rather than the default,
  so a deleted account gets nothing.
- **Month.** UTC. `usage_monthly.month` is the first day of the month. The counter resets
  implicitly when the month changes (a new row), with no job. `resetsAt` is the first moment of
  the next UTC month.

`GET /api/me/usage` returns the month, runs used and limit, resumes held and limit, the
upload cap, the tier, the per-kind breakdown and `resetsAt`. `GET /api/meta` returns the
default tier's upload limit for the public sign-up page.

## 3. Charging atomically

`usage_monthly` in PostgreSQL is the only counter: one row per `(user_id, month, kind)` with
`runs`.

`assertRunsLeft(userId, cost)` is a cheap pre-check that gives a clean 429 before any work is
queued. `chargeRuns(userId, cost, kind)` is the authority. Inside one transaction it:

1. takes a per-user advisory lock: `pg_advisory_xact_lock(hashtext('quota:<user id>'))`;
2. re-reads the month's total and the limits;
3. throws `QuotaExceededError` if `used + cost` would pass the limit, changing nothing;
4. otherwise upserts the row with `runs = runs + cost`.

Two parallel requests on the last run therefore cannot both succeed, across any number of API
tasks, because the lock lives in the database. `refundRuns(userId, cost, kind)` is a single
`UPDATE ... SET runs = greatest(runs - cost, 0)` on the row for the current month and kind.

A separate advisory lock `resume-slot:<user id>` serialises the resume-count re-check and the
insert, and `drafts:<user id>` does the same for the 50-draft cap.

## 4. Costs per action

| Action | Runs | Usage kind | Charged when | Refunded when |
| --- | --- | --- | --- | --- |
| Upload a resume (analysis, rewrite, cover letter) | 1 | `analyze` | Before the file is stored | The request fails before the job is queued; the job fails finally; the component is reaped as stale |
| Analyse a builder document (`from-document`) | 1 | `analyze` | Same | Same |
| Tailor a resume to a job | 1 | `analyze` | Same | Same |
| The non-technical interview set in the default pipeline | 0 | none | Rides on the analysis run | Nothing to refund |
| Generate an interview track on demand (4 tracks) | 1 each | `interview` | Before queueing | Same as above |
| Generate the roadmap | 1 | `roadmap` | Same | Same |
| Generate project ideas | 1 | `projects` | Same | Same |
| Retry a failed step | 1 per job retried | the job's kind | Before queueing | Same; also refunded if the job is already running |
| Builder chat message | 1 | `builder` | Before the model is called | The model is unavailable, returns bad output, or the client goes away |
| Builder import of an existing resume | 1 | `builder` | Same | Same |
| Preview, PDF, DOCX, download, template change | 0 | none | | |
| Drafts, preferences, account export | 0 | none | | |

The costs live in the `COMPONENTS` table in
[`services/resume/components.ts`](../../apps/api/src/services/resume/components.ts), so there
is one place to change a price.

### Charge, refund and idempotency rules

- **Charge first, queue second.** A run is taken before the work is queued, so a request that
  cannot be paid for does nothing. Anything that fails on our side before the queue gives the
  run back (`startResume`, `queueJobs`).
- **One charge per job.** The charge sits on the first row a job covers (`resume_components.charged`),
  zero on the others. A final failure sums `charged`, zeroes it and refunds exactly that.
- **Several jobs, all or nothing.** `chargeJobs` charges them in order; if a later one is
  refused, the earlier ones are refunded.
- **A refused charge is a 429.** On the resume endpoints it is `QUOTA_EXHAUSTED` with
  `details: { limit, used, resetsAt }`. On the builder endpoints it is `QUOTA_EXCEEDED` (a
  second code for the same condition; the web app treats both alike). The web app shows the
  quota notice and the reset date.
- **A run is not refunded when the work succeeded but the user dislikes it.** Only failures on
  our side are refunded.
- **Double clicks.** A second request for a component that is already queued or running is
  refunded and answered `409 ALREADY_RUNNING`.
- **Tokens are not metered.** Quotas count runs, not tokens or money. A run on a large model
  costs the operator more than a run on a small one, and the quota does not know. Operators
  who care should keep the model catalogue small.

## 5. Resume slots

`max_resumes` counts every row in `resumes` the user owns, including tailored copies and
builder resumes. At creation the API checks the count before charging and again, under the
`resume-slot` advisory lock, inside the transaction that inserts the row. At the limit the
answer is `409 RESUME_LIMIT` with `details: { limit }`; the user deletes a resume to add
another. Deleting a resume frees the slot at once and does not refund runs.

## 6. Upload limits

| Layer | Limit |
| --- | --- |
| Tier | `max_upload_mb`, 1 to 500 |
| API ceiling | 10 MB (`MAX_UPLOAD_BYTES`); the effective limit is `min(10 MB, tier)` |
| Multipart reader | One file, up to 12 fields, field size 100,000 bytes; the file is cut at the limit and the request refused with `413 FILE_TOO_LARGE` |
| Text caps | Extracted text 31,000 characters; job description 20,000 characters stored, 8,000 sent to a model |
| Builder import | A fixed 10 MB, not the tier's value |

The sibling limits on the resume itself (30 experience entries, 30 bullets each, and so on) are
in [rendering-and-templates.md](rendering-and-templates.md#1-the-canonical-document).

## 7. Admin and audit

Admins manage tiers (`/api/admin/tiers`), put an account on a tier (`PUT
/api/admin/users/:id/tier`) and set or remove an override (`PUT` and `DELETE
/api/admin/users/:id/quota`). Changes are audited (`tier.save`, `tier.delete`, `user.tier`,
`user.quota_override`, `user.quota_override_removed`). The admin user detail shows the tier,
the override, the effective limits and six months of usage
([`usageByMonth`](../../apps/api/src/services/quota.service.ts)). Usage rows hold counts
and kinds only, never resume text.

## 8. Rate limits are separate

Quotas are a monthly budget; rate limits (for example 20 uploads per hour, 30 retries and
on-demand generations per hour) protect the server from bursts and are a different layer
([LLD.md](LLD.md#5-rate-limits)).

## 9. Edge cases worth knowing

- A refund is applied to the **current** UTC month's row. A run charged on the last day of a
  month and refunded after midnight decrements the new month's row (clamped at zero), not the
  old one. The effect is at most a few runs for a job that straddles midnight.
- The pre-check and the charge are separate reads, so a request can pass the pre-check and
  then be refused by the charge. That is intended: the charge is the authority.
- A resume whose job finally fails keeps its slot; the user can retry it (one run) or delete it.
