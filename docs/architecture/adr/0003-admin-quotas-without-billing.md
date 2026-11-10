# ADR 0003: Admin-managed monthly quotas, no billing

## Status

Accepted.

## Context

Every AI run costs the operator money at a model provider (or CPU on the offline engine). A
deployment for a team or a community needs to stop one person, or one stolen session, from
using the month's budget in an afternoon, and to give some people more than others. A billing
system (plans, payments, invoices) is a different product, and most operators of a private
resume tool do not charge their users.

## Decision

- The unit is an **AI run**, counted per user per UTC calendar month. Alongside it sit a
  resume count and an upload size ([`quota.service.ts`](../../../apps/api/src/services/quota.service.ts)).
- Allowances come from `quota_tiers` (a `Default` tier is seeded with 20 runs, 10 resumes and
  10 MB; exactly one tier is the default, by a partial unique index), with an optional
  `user_quota_overrides` row on top. `NULL` means unlimited in a tier, and means "use the tier"
  in an override. Admins manage tiers and overrides in `/admin`.
- Costs are a table in code ([`components.ts`](../../../apps/api/src/services/resume/components.ts)):
  one run for an analysis, an on-demand interview track, the roadmap, project ideas, a builder
  chat message and a builder import; zero for the default non-technical interview set, for
  previews, downloads and drafts.
- The counter is **PostgreSQL**: one `usage_monthly` row per `(user, month, kind)`. `chargeRuns`
  takes a per-user advisory lock in a transaction, re-reads the total and the limits, and adds
  the cost only if the result stays within the limit, so two parallel requests cannot both take
  the last run across any number of API tasks.
- A run is charged **before** the work is queued and refunded when the work fails on our side:
  a failure before the queue, a final job failure, a stale component reaped later, an AI
  failure on the builder routes.
- A spent allowance is `429` (`QUOTA_EXHAUSTED` on resume endpoints, `QUOTA_EXCEEDED` on
  builder endpoints) with the reset date. Rate limits are a separate layer.

## Consequences

Positive:

- The operator's spend is bounded per person per month with one setting, adjustable per group
  or person without code.
- The counter is durable and exact, and the same rows give the admin usage by month and kind.
- Charging first means a request that cannot be paid for does nothing; refunds mean the user
  is not charged for our failures.
- Counting in the database needs no Redis state that could drift or be lost.

Trade-offs:

- Runs are not tokens or money. A run on a large model costs more than one on a small model and
  the quota does not know. There are no per-model weights.
- An override cannot remove a limit (a `NULL` field falls back to the tier); unlimited means
  a tier with `NULL`.
- A refund goes to the current month's row, so a job that straddles midnight on the last day of
  a month can leave a small drift.
- No money, no self-service upgrades, no invoices.

## Alternatives considered

- **Billing with plans and payments.** A different product; it can be built on top of tiers.
- **Counting in Redis.** Faster, but a second source of truth to seed, expire and reconcile, with
  no durable history. Postgres is fast enough for a handful of charges per user per hour.
- **Token metering.** Accurate, but providers report usage differently, the offline engine has
  no tokens, and users cannot predict the cost of an action. A run is something a person can
  understand.
- **Daily allowances.** Resume work is bursty (a job search week, then nothing); a monthly
  allowance matches it better.
