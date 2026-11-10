# Operations

Running a deployment day to day: health, logs, alarms, background jobs and queues, quotas,
account deletion, backups, migrations, rotating secrets, scaling and upgrades. Names below
use `<name_prefix>` from `terraform.tfvars`.

## Health endpoints

| Endpoint | Answers | Used by |
| --- | --- | --- |
| `GET /up` | `{ ok: true }` while the process runs | The container health check |
| `GET /api/ready` | `{ ok: true }` when Postgres and Redis answer, else 503 | The ALB target group health check |
| `GET /` (web) | 200 when Next renders | The web target group |

Neither API endpoint is written to the access log ([`app.ts`](../../apps/api/src/app.ts)).
The worker has no port; ECS watches the process.

## Logs

Every service logs pino JSON to CloudWatch Logs, group `/open-resume/<name_prefix>/<service>`
(`api`, `worker`, `web`, and the one-off `migrate` and `admin` tasks). Each API line carries
the request id that error bodies return as `requestId`, so a user's report with a request id
finds the line. Locally: `make logs SERVICE=api`.

What is never in a log ([`core/logger.ts`](../../apps/api/src/core/logger.ts)): passwords,
tokens, one-time codes, cookies, authorization headers and API keys (redacted by field name
up to three levels deep), and resume content: the pipeline logs task names, ids, token totals
and call counts, never text. Provider error bodies are cut to 600 characters with key-shaped
strings masked.

Useful CloudWatch Logs Insights queries:

```
fields @timestamp, msg, job, attempts | filter level >= 50 | sort @timestamp desc
fields @timestamp, provider, status, body | filter msg = "provider call failed" | sort @timestamp desc
fields @timestamp, task, offline, inputTokens, outputTokens, calls | filter msg = "resume ai task done"
fields @timestamp, msg | filter msg like /structured answer rejected/
```

The third one shows which tasks ran on the offline engine (`offline: true`) and how many
tokens the others used.

## Alarms

[`modules/observability`](../../infra/terraform/modules/observability/main.tf) creates
CloudWatch alarms that notify `alarm_email` through SNS:

| Alarm | Fires on |
| --- | --- |
| `<name_prefix>-<service>-5xx`, `-unhealthy` | More than 25 5xx responses from api or web tasks; any unhealthy target |
| `<name_prefix>-<service>-cpu`, `-memory` | CPU or memory above 85% (every service, including the worker) |
| `<name_prefix>-db-cpu`, `-storage`, `-connections` | Database CPU, low free storage, connections above 80% of the ceiling |
| `<name_prefix>-worker-failed-jobs` | Failed job attempts in the worker log group above the threshold in 5 minutes |

The cache module adds its own Redis alarms to the same topic.

## Background jobs

Jobs are named handlers with a JSON payload ([`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)).
The queue is the first segment of the name. Each worker task runs one BullMQ worker per
queue with concurrency 4.

| Job | Queue | Retries | Enqueued by | Does |
| --- | --- | --- | --- | --- |
| `resume-ai.run` | `resume-ai` | 3 attempts, exponential backoff from 10 s | Upload, builder analyse, tailor, retry, on-demand generation | One unit of AI work on a resume: `analysis` (covers analysis and rewrite), the four interview tracks, `roadmap` or `projects`. Payload is ids only; the content is read from the database and storage |
| `maintenance.lift-suspensions` | `maintenance` | 5, from 5 s | Schedule, every 5 minutes | Timed suspensions that have run out become ACTIVE (also lifted lazily at sign-in) |
| `maintenance.purge-accounts` | `maintenance` | 5, from 5 s | Schedule, every 6 hours | Erases accounts whose deletion request is older than 14 days, re-checking each under a row lock |

Schedules are registered by every worker on boot as repeatable jobs keyed by name and
interval, so exactly one schedule exists however many workers run
([`worker.ts`](../../apps/api/src/worker.ts)). Every handler is safe to run twice or on two
workers at once.

### How a resume job is made safe

- A job takes its component row with a conditional `UPDATE` (a claim). A duplicate delivery
  or a second worker finds it claimed and does nothing.
- A claim older than 10 minutes is a crashed worker; another worker may take the job.
- A failed attempt goes back to the queue until 3 attempts have run; the final failure marks
  the component `failed` with a message safe to show, and gives the charged run back.
  Problems with the user's file are never retried.
- A component that stays `processing` for 30 minutes lost its job. The next time anyone loads
  that resume (`GET /api/resumes/:id`), it is failed and refunded in one statement. No cron
  is involved.

### `JOBS_MODE`

| | `queue` (default, every deployment) | `inline` (tests, tiny installs, `demo:seed`) |
| --- | --- | --- |
| Where handlers run | The worker process | The API process, right after commit |
| Retries | BullMQ, 3 attempts (resume) | The pipeline loops its own attempts; other jobs log an error |
| Schedules | Registered by the worker | None: no suspension lifting, no purge |
| Production | OK | Refused by the production guard |

If the worker is down, new uploads stay `queued` (the app keeps polling), nothing is lost,
and they run when a worker returns. Everything that does not need a job keeps working:
previews, exports, editing, the builder, sign-in.

### Inspecting the queues

BullMQ keeps its state in Redis under the prefix `bull:`:

```bash
redis-cli -u "$REDIS_URL" --scan --pattern 'bull:resume-ai:*' | head
redis-cli -u "$REDIS_URL" llen bull:resume-ai:wait        # waiting jobs
redis-cli -u "$REDIS_URL" zcard bull:resume-ai:failed     # failed jobs (the last 5000 are kept)
redis-cli -u "$REDIS_URL" zcard bull:resume-ai:delayed    # waiting for a retry backoff
```

On AWS the cache requires TLS and an AUTH token (`REDIS_URL` is in the cache's secret), so
run this from a host inside the VPC. Completed jobs are kept up to 1,000. A resume's own state
is more useful than the queue's: the `resume_components` rows (`status`, `error`,
`claimed_at`) say what happened to each unit of work.

## Quotas administration

There is no billing: administrators decide who gets how much, in `/admin/quotas` and on a
member's sheet in `/admin/users`.

| Limit | Meaning | Where it bites |
| --- | --- | --- |
| `monthlyRuns` | AI runs per UTC month | Upload (1), tailor (1), retry, each on-demand interview track, roadmap or project set (1 each), each builder message and import (1) |
| `maxResumes` | Resumes a member may hold | Upload and tailor: `409 RESUME_LIMIT` |
| `maxUploadMb` | Largest upload (never above 10 MB) | `413 FILE_TOO_LARGE` |

A blank limit means unlimited. Resolution, field by field: the member's own override beats
their tier, which beats the default tier. A member with no tier is on the default tier (seeded
`Default`: 20 runs a month, 10 resumes, 10 MB). The default tier cannot be deleted
(`TIER_IS_DEFAULT`), and there is always exactly one; deleting any other tier puts its
members back on the default.

How the count works ([`services/quota.service.ts`](../../apps/api/src/services/quota.service.ts)):
`usage_monthly` has one row per (user, UTC month, kind) and is the only counter. A cheap
pre-check gives a clean `429` before any work is queued; the charge itself takes a per-user
advisory lock, re-reads the limit and adds the cost only if it fits, so two parallel
requests cannot both take the last run. A charge is refunded when the work fails on our side.
The upload that exhausts the month is refused before the file is stored. Counters reset by
the calendar: the first of the next UTC month, no job involved.

What members see: `GET /api/me/usage` (shown in Settings and as a notice when they run out).
What admins see: the overview charts (runs by kind), and per member the runs by month.

To give one person more: open them in `/admin/users`, set **Own limits** (a note records
why). To change a tier's numbers, edit the tier; it takes effect on the next request.

## Retention, account deletion and erasure

Resumes are kept until their owner deletes them or the account is erased; there is no
automatic expiry.

| Path | What happens |
| --- | --- |
| A member deletes their account (`DELETE /api/users/me`) | Signed out everywhere, `deletion_requested_at` set. Signing in within 14 days cancels it; after that `maintenance.purge-accounts` erases it |
| An admin erases an account (`POST /api/admin/users/:id/erase`, reason required) | Immediate |

Erasure ([`services/account.service.ts`](../../apps/api/src/services/account.service.ts))
anonymises the user row (email, username, name, password, two-factor), revokes sessions,
deletes the member's resumes, drafts, preferences, quota override and monthly usage, and
removes the stored files once the transaction commits. The last active admin cannot delete themselves
(`409 LAST_ADMIN`). A member can download their data first (`GET /api/users/me/export`).

## Audit trail

`audit_log` records every admin action (role, suspend and ban, erase, tier, override,
provider and model changes, settings with before and after values), account events (sign-up,
sign-in, email verified, two-factor changes, password changes, export, deletion requested
and cancelled), session events, the admin bootstrap, and the jobs that change accounts
(`user.suspension_lifted`, `user.purged`). Read it at `/admin/audit` (`GET /api/admin/audit`,
filterable by action prefix, actor and entity). Admins cannot read resumes; the trail is how
their actions are accounted for.

## Backups and restore

| Store | Backup |
| --- | --- |
| Postgres (RDS) | Automated snapshots: 3 days in `aws-dev`, 14 days in `aws-prod` (`db_backup_retention_days`), point-in-time restore inside that window |
| S3 (uploaded originals) | Versioning on; objects are encrypted with the deployment's KMS key |
| Redis | Snapshots (1 day `aws-dev`, 7 days `aws-prod`). Nothing in Redis is the only copy of anything durable: queued jobs are retried or recovered from the `resume_components` rows, rate-limit counters expire, quota counters are in Postgres |

To restore, create an RDS instance from a snapshot and point the deployment at it (or
restore in place under the same identifier). A resume row whose original file is gone still
opens (the improved resume lives in the database); downloading the original answers `404`.

## Migrations

[`db/migrate.ts`](../../db/migrate.ts) applies `db/migrations/*.sql` in filename order,
forward-only, each in its own transaction, under a Postgres advisory lock, recording a
checksum of each in `schema_migrations`. Locally it runs as the compose `migrate` one-shot;
on AWS as the migrate task (`make aws-migrate`, and step 4 of `make aws-deploy`). Never edit
an applied migration: the runner stops with `<file> changed after it was applied`.

```bash
pnpm db:migrate --status     # list applied and pending without changing anything
pnpm db:migrate              # apply pending ones (DATABASE_URL, or the local default)
```

To add a schema change: write `db/migrations/NNNN_description.sql` with the next number and
update `apps/api/src/db/types.ts` (generated with `pnpm --filter @open-resume/api db:types`
against a migrated database). `MIGRATE_ON_BOOT=true` makes the API apply pending migrations
at start instead, which is only for tiny installs.

### Least-privilege database role

By default the api and worker connect as the RDS master user, the same one the migrate task
needs for DDL. To run them as a role that cannot change the schema, create one by hand after
the first deploy, from any host that can reach the private database (a bastion or a session
inside the VPC), connected as the master user:

```sql
CREATE ROLE resume_app LOGIN PASSWORD '<a long random password>';
GRANT CONNECT ON DATABASE resume TO resume_app;
GRANT USAGE ON SCHEMA public TO resume_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO resume_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO resume_app;
-- Tables created by later migrations (run as the master user, resume_admin by default):
ALTER DEFAULT PRIVILEGES FOR ROLE resume_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO resume_app;
ALTER DEFAULT PRIVILEGES FOR ROLE resume_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO resume_app;
```

Store `{"username":"resume_app","password":"<the password>"}` in a Secrets Manager secret
encrypted with the deployment's KMS key, then set `app_db_secret_arn` (the secret's ARN) and
`app_db_username = "resume_app"` together in `terraform.tfvars` and apply. The api and worker
now read that secret for each new connection; migrate and admin keep the master user. Verify
with the API log and `GET /api/ready`, then confirm `resume_app` cannot `CREATE TABLE`.

## Rotating secrets

| Secret | How | Effect |
| --- | --- | --- |
| `JWT_SECRET` | Put a new value in `<name_prefix>/app`, roll api and worker | Every access token is invalid; the web app refreshes silently |
| `REFRESH_SECRET` | Same | Signs out everyone |
| `TOTP_ENCRYPTION_KEY` | Do not rotate casually | Every enrolled authenticator stops working; members would need recovery codes (and those are keyed by the same secret) |
| `PROVIDER_KEYS` | Put the new JSON in `<name_prefix>/provider-keys`, roll api and worker | Immediate on new tasks; revoke the old key at the provider after the roll |
| Database password | RDS rotates the managed secret | New connections read the new password (cached 60 s); no restart |
| Redis AUTH token | Rotate in ElastiCache and update the cache's secret, roll all services | Brief interruption while tasks restart |

`aws secretsmanager put-secret-value --secret-id <name> --secret-string '<full value>'`, then
roll with `aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment`
for the api and the worker (or re-run `make aws-deploy`).

## Scaling

| Component | How it scales | What makes that safe |
| --- | --- | --- |
| API tasks | Horizontally on CPU (target tracking; `api_min_count` to `api_max_count`) | Sessions in Postgres, rate limits and queues in Redis, settings and the model catalogue cached 5 s per process; no stickiness |
| PDF export | With the API tasks | One Chromium per process, `PDF_CONCURRENCY` pages at once (default 2), a queue of 25 behind them, recycled every `PDF_RECYCLE_PAGES` pages. Raise task counts before raising concurrency |
| Worker tasks | Horizontally (`worker_min_count` to `worker_max_count`: dev 1 to 1, prod 2 to 6) | BullMQ locks jobs; handlers are idempotent claims. Each task runs 4 jobs per queue at once |
| Web tasks | Horizontally | Stateless |
| Postgres | Vertically, storage autoscaling | Resumes hold JSON documents and every query is keyed by owner; watch connections: tasks times `DB_POOL_MAX` |
| Redis | Vertically; `aws-prod` runs two nodes with failover | Holds queues and rate limits only |

A resume job waits on the model, not the CPU, so one worker task handles many members.
Throughput per member is bounded by the rate limits and the monthly runs. Provider rate
limits surface as `AI_UNAVAILABLE` ("The AI service is busy right now") and are retried by
the job.

To scale by hand: in `envs/<env>/main.tf` change `worker_min_count`/`worker_max_count` and
apply, or temporarily `aws ecs update-service --desired-count`. Autoscaling owns the running
count after the first deploy.

## Failure modes

| Failure | Effect | Recovery |
| --- | --- | --- |
| Postgres down | `/api/ready` 503, tasks leave rotation | RDS failover (`aws-prod` Multi-AZ) |
| Redis down | `/api/ready` fails; rate limits fall back to per-task memory; jobs cannot be enqueued, so uploads and generation fail and are refunded | ElastiCache failover in `aws-prod` |
| A model provider down or rate limiting | That job is retried 3 times, then the component is `failed` with a plain message and refunded; the builder answers `503 AI_UNAVAILABLE` | Members retry; switch the default model in `/admin/models` |
| A model returns unusable JSON | One repair attempt, then `AI_BAD_OUTPUT` (502 in the builder; a failed component in the pipeline) | Pick a stronger model; raise its max output tokens |
| Worker down | Uploads stay `queued`; nothing is lost; maintenance waits | Jobs run when a worker returns |
| Chromium missing or out of memory | Preview and export fail; everything else works | See [troubleshooting.md](troubleshooting.md#export-and-rendering) |
| Bad image deployed | The deployment circuit breaker rolls back | Redeploy a previous tag |

## Upgrading

1. Read `CHANGELOG.md` for the release and any new environment variable
   ([configuration.md](configuration.md)).
2. Locally: `git pull`, `pnpm install`, `make down && make up` (volumes are deleted by
   `make down`; keep them with `docker compose ... down` without `-v` if you want the data).
3. On AWS: `make aws-deploy ENV=<env>` builds the new images, runs the migrate task, then
   rolls the services; roll back a bad deploy by redeploying the previous tag.
4. Migrations are forward-only. Back up before an upgrade that adds one: take an RDS
   snapshot (`aws rds create-db-snapshot`).
