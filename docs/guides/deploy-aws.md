# Deploy to AWS

Deploy Euron Open Resume AI to your own AWS account with the Terraform in
[`infra/terraform`](../../infra/terraform) and one script. The result is one host name
(`https://<domain>`) serving the web app and `/api/*`, with ECS Fargate services in private
subnets, RDS PostgreSQL, ElastiCache Redis, a private S3 bucket, SES, Secrets Manager and a
customer-managed KMS key. The system view is in [HLD.md](../architecture/HLD.md).

## What gets created

The composition is one module, [`modules/deployment`](../../infra/terraform/modules/deployment/main.tf);
the environments [`envs/aws-dev`](../../infra/terraform/envs/aws-dev/main.tf) and
[`envs/aws-prod`](../../infra/terraform/envs/aws-prod/main.tf) only pick sizes and safety
switches. ([`envs/local-floci`](../../infra/terraform/envs/local-floci/main.tf) is the
emulator environment `make up` applies.)

| Path | Service | Role |
| --- | --- | --- |
| `https://<domain>/api/*`, `/up` | api | The JSON API: auth, uploads, previews, PDF and DOCX export (headless Chromium runs here) |
| `https://<domain>/*` | web | Next.js: the app and `/admin` |
| no inbound traffic | worker | BullMQ jobs: text extraction, the resume AI pipeline and upkeep |
| one-off | migrate, admin | Task definitions on the api image: apply migrations; create the first administrator |

| | aws-dev | aws-prod |
| --- | --- | --- |
| Availability zones, NAT | 2, one shared NAT | 3, one NAT per AZ, interface endpoints |
| RDS PostgreSQL 16 | single AZ, `db.t4g.small`, 3 days of backups, no deletion protection | Multi-AZ, `db.t4g.medium`, 14 days, deletion protection |
| ElastiCache Redis | 1 node `cache.t4g.small`, 1 day of snapshots | 2 nodes `cache.m7g.large` with failover, 7 days |
| Tasks (min to max) | api 1 to 2, worker 1, web 1 to 2 | api 2 to 10, worker 2 to 6, web 2 to 6 |
| CloudFront + WAF | off by default (`enable_cdn = false`) | on by default |
| KMS deletion window, secret recovery window | 7 days, 0 | 30 days, 30 days |
| Log retention | 14 days | 365 days |

Task sizes are the module defaults: api 1 vCPU / 2 GB, worker 1 vCPU / 2 GB, web 0.25 vCPU /
512 MB; the one-off tasks 0.25 vCPU / 512 MB. Services scale on CPU (target tracking) and roll
out with the ECS deployment circuit breaker and automatic rollback.

## Prerequisites

- An AWS account and credentials for it (a profile with administrator rights for the first
  apply).
- `terraform` (1.16), `docker` with buildx, the AWS CLI and `python3`.
- A domain. With a Route 53 hosted zone (`route53_zone_id`) the certificate and DNS records
  are created for you; otherwise pass `certificate_arn` for an ACM certificate you made in
  the same region and point your DNS at the load balancer (see
  [DNS and certificates](#dns-and-certificates)). One of the two is required.
- A sending domain for SES (`mail_domain`, defaults to `domain`). New SES accounts are in the
  sandbox: verify the recipient addresses or request production access.

## Configure

```bash
cp infra/terraform/envs/aws-dev/terraform.tfvars.example infra/terraform/envs/aws-dev/terraform.tfvars
cp infra/terraform/envs/aws-dev/backend.tf.example infra/terraform/envs/aws-dev/backend.tf   # remote state (recommended)
```

State contains generated secrets: keep the bucket private, versioned and encrypted. The
inputs (the same list for both environments, in `variables.tf`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `region` | none | Where |
| `name_prefix` | none | Prefix of every name; 3 to 24 lowercase letters, digits and hyphens. The media bucket derives from it: make it globally unique |
| `domain` | none | The one public host (web and `/api/*`) |
| `route53_zone_id` | null | Hosted zone: automatic certificates and DNS records |
| `certificate_arn` | null | An existing regional certificate, when the zone is not in Route 53 |
| `mail_domain` | `domain` | SES sending domain |
| `image_tag` | passed by `make aws-deploy` | The git commit; set it to pin a release |
| `product_name` | `Euron Open Resume AI` | Shown in the app and emails |
| `enable_cdn` | dev false, prod true | CloudFront and WAF in front of the load balancer (needs `route53_zone_id`) |
| `alarm_email` | null | Who receives the CloudWatch alarms |
| `provider_keys` | null | Optional map of keys by slug. Leave null to keep them out of Terraform state and fill the secret by hand |
| `cpu_architecture` | `X86_64` | Or `ARM64` (Graviton, cheaper). Images must match |
| `db_instance_class`, `cache_node_type` | see table above | Database and cache sizes |
| `app_db_secret_arn`, `app_db_username` | null | A least-privilege application role for the api and worker ([operations.md](operations.md#least-privilege-database-role)); set both or neither |
| `require_email_verification` | `true` | Passed to the API |
| `log_level` | `info` | Passed to the API and worker |
| `api_extra_environment` | `{}` | Extra plain variables for the api and worker (names from [configuration.md](configuration.md)). Never secrets |
| `api_extra_secrets` | `[]` | ECS secret references, for example `[{ name = "SMTP_PASS", valueFrom = "<secret arn>:SMTP_PASS::" }]` |
| `media_cors_extra_origins` | `[]` | Extra browser origins for the bucket's CORS rule (`http://localhost:3630` for `make up-aws`) |
| `extra_tags`, `environment` | `{}`, dev or prod | Tags |

Inside the module there are more knobs (task sizes, autoscaling bounds, `migrate_on_boot`,
`db_pool_max`); the environments set what matters.

## Deploy

```bash
make aws-deploy ENV=aws-dev
```

[`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) tags images with the current commit
(`TAG`, override it to pin a release) and runs:

1. `terraform apply` of the image registries (and the KMS key that encrypts them);
2. `docker buildx build --push` of the api and web images for `PLATFORM`, which must match
   `cpu_architecture` (`linux/amd64` for `X86_64`, `linux/arm64` for `ARM64`; a mismatch
   builds fine and then dies with `exec format error`, and the script refuses to start on a
   disagreement). The worker runs the api image with another command;
3. `terraform apply` of what the migrate task needs (network, database, task definition);
4. the migrate task, waited for ([`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh));
   it must exit 0;
5. `terraform apply` of everything else: cache, edge, the api, worker and web services;
6. `aws ecs wait services-stable`.

It ends by printing the app URL and the secrets that still hold `set-me` placeholders.
`make aws-plan ENV=aws-dev` plans without applying (it needs `terraform.tfvars`);
`make aws-migrate ENV=aws-dev` runs the migrate task alone.

The first deploy takes a while: RDS, ElastiCache, the certificate and CloudFront each take
minutes to create.

## DNS and certificates

- **Zone in Route 53** (`route53_zone_id`): Terraform requests the ACM certificate, writes the
  validation records, points the host at CloudFront or the load balancer and creates the
  SES DKIM and verification records. Nothing to do by hand.
- **Zone elsewhere** (`certificate_arn`, with `enable_cdn = false`): create a certificate
  for the host in the deployment region and validate it in ACM before applying. After the
  apply, create a CNAME (or alias) from the host to `terraform output load_balancer_dns_name`,
  and publish the records in `terraform output mail_dns_records` for SES. If Terraform
  creates the certificate for you, publish `certificate_validation_records` while the apply
  waits.
- CloudFront needs a certificate in `us-east-1`; the environments declare an `aws.us_east_1`
  provider for it, which is why `enable_cdn` requires Route 53 (the certificate is validated
  through DNS).

## Secrets

Everything secret lives in Secrets Manager, encrypted with the deployment's KMS key, and is
injected by ECS as environment variables; nothing secret is in a task definition or a log
([`modules/secrets`](../../infra/terraform/modules/secrets/main.tf)).

| Secret | Holds | Created with |
| --- | --- | --- |
| `<name_prefix>/app` | `JWT_SECRET`, `REFRESH_SECRET` | 64 random characters each, distinct |
| `<name_prefix>/totp` | `TOTP_ENCRYPTION_KEY` | 32 random bytes, base64. Not rotated with the signing keys: rotating it invalidates every enrolled authenticator |
| `<name_prefix>/provider-keys` | `PROVIDER_KEYS`: one JSON object keyed by provider slug | `set-me` per slug unless `provider_keys` was passed |
| the cache module's secret | `REDIS_URL` with its AUTH token, TLS | Generated |
| the RDS-managed secret | The database master password | RDS (rotated by RDS; the API reads it per connection through `DATABASE_SECRET_ARN`) |

Terraform never overwrites a secret value after creation (`ignore_changes` on the string), so
values you put in by hand stay.

### Provider keys

The app runs without any (the offline engine answers). To use real models:

```bash
aws secretsmanager put-secret-value --secret-id <name_prefix>/provider-keys \
  --secret-string '{"openai":"<openai-key>","anthropic":"<anthropic-key>"}'
```

The slug names must match the providers you create in `/admin/models`
([connect-real-providers.md](connect-real-providers.md)). Then roll the API and worker so they
read the new values: run `make aws-deploy` again, or

```bash
aws ecs update-service --cluster <cluster> --service <api service> --force-new-deployment
aws ecs update-service --cluster <cluster> --service <worker service> --force-new-deployment
```

(`terraform output cluster_name` and `terraform output services` give the names.)

## The first administrator

```bash
make aws-admin ENV=aws-dev EMAIL=you@example.com
```

This runs `node dist/cli.js admin:create --email you@example.com` as a one-off task
([`services/admin-bootstrap.service.ts`](../../apps/api/src/services/admin-bootstrap.service.ts)):
it promotes an existing account without touching its password, or creates the account and
emails a set-password link through SES. It never prints a password (task output goes to
CloudWatch Logs; do not pass `--print-password` there). When the link cannot be emailed it
creates nothing and exits non-zero: verify the SES identity first, and in the SES sandbox the
recipient too.

## First-time setup in `/admin`

A production install starts with the starter model catalogue (OpenAI, Anthropic and Gemini
models, offered once their keys exist) and the seeded `Default` quota tier; the demo and its
stub provider are never created in production.

1. **Models**: confirm the providers whose keys you stored; edit model ids if a provider has
   moved on; press **Test** on each ([connect-real-providers.md](connect-real-providers.md)).
2. **Quotas**: review the `Default` tier (20 runs a month, 10 resumes, 10 MB uploads) and
   create others ([operations.md](operations.md#quotas-administration)).
3. **Settings**: name and tagline, registration (`OPEN`, `INVITE_ONLY` with your email
   domains, or `CLOSED`), support email, house instructions
   ([configuration.md](configuration.md#deployment-settings-adminsettings)).

## Chromium in Fargate

The API renders PDFs with headless Chromium (previews, exports and the builder), installed
from the Debian package in the image, which the worker shares (`/usr/bin/chromium`, fonts for Latin, Greek, Cyrillic, Devanagari and emoji).
What the deployment does so that works:

- Memory: Chromium does not fit in less than 2 GB. The api is 2048 MiB by default for that
  reason. `worker_memory` also has a validation that rejects anything below 2048 MiB (the
  module's own description says the worker renders PDFs; in this code only the API does,
  the worker extracts text and calls the model).
- `CHROMIUM_NO_SANDBOX=1`: Chromium's user-namespace sandbox is unavailable in a Fargate
  container. The renderer compensates: JavaScript is off and every request except `data:`
  and `about:` is aborted, so resume content cannot reach the network or the task's
  metadata endpoint.
- The root filesystem is read-only. `HOME=/tmp` and a writable `/tmp` volume carry
  Chromium's profile and crash files.
- One shared browser per process, `PDF_CONCURRENCY` pages at once (default 2), recycled
  every `PDF_RECYCLE_PAGES` pages (default 100) to cap memory growth.

If exports fail after a deploy, see [troubleshooting.md](troubleshooting.md#export-and-rendering).

## CloudFront and WAF

With `enable_cdn = true` CloudFront serves the host, WAF is attached (`enable_waf`), the
load balancer accepts only CloudFront's origin ranges, and both listener rules require a
secret `X-Origin-Verify` header that only this distribution sends; anything else gets 403.
`TRUST_PROXY` becomes 2. Static assets are cached; pages and `/api/*` are not.

## Costs and sizing

These are the line items that drive the bill, in roughly the order they matter for a small
install. Prices vary by region and change; use the AWS Pricing Calculator with your numbers.

| Item | Driver | Lever |
| --- | --- | --- |
| NAT gateways | One per AZ in `aws-prod`, one in `aws-dev`, billed per hour and per GB | `aws-dev` shares one; `aws-prod` pays for resilience |
| RDS | Instance class, Multi-AZ doubles it, storage | `db_instance_class`; start small, the load is light |
| ElastiCache | Node type times node count | `cache_node_type`; Redis holds only queues and rate-limit counters |
| Fargate | vCPU and memory of every task, times the minimum counts | `cpu_architecture = "ARM64"` is cheaper; minimum counts are 1 (dev) and 2 (prod) |
| Load balancer, CloudFront, WAF | Hours plus requests | `enable_cdn = false` in dev |
| Logs and flow logs | Ingest and retention | `log_level`, retention days in the environment files |
| Model providers | Tokens: one analysis is 3 model calls, each interview, roadmap or project set is 1, each builder message 1 | Quota tiers cap runs per member per month |
| SES | Per message | Negligible at this volume |

Sizing guidance: the api is the Chromium consumer (every PDF export), the worker extracts
text from uploads and waits on model calls; scale the api for export traffic and the
worker for upload and analysis traffic. A run waits on the model, not on the
CPU, so a single worker task handles many members; `concurrency` is 4 jobs per queue per
task. The database is lightly loaded: resume rows hold JSON documents, queries are keyed by
owner. Watch `db-connections` before raising task counts: connections are tasks times
`DB_POOL_MAX` (default 10).

## Updating

Commit, then `make aws-deploy ENV=aws-prod` again: new images, migrations, then the
services roll. Migrations are forward-only and checksummed; a deploy never edits an
applied one. A bad image is rolled back by the circuit breaker; redeploy a previous tag with
`TAG=<commit> make aws-deploy ENV=...`.

A rolling deploy stops old tasks with SIGTERM: the API stops accepting requests and finishes
in-flight ones (forced after 25 s), the worker closes its queues. A job that was running is
retried by BullMQ or recovered by the stale-claim rules ([operations.md](operations.md#background-jobs)).

## Using real AWS from your laptop

`make up-aws` runs the local stack against real AWS resources (an `aws-dev` bucket and SES
configuration set) with your AWS profile: copy
[`deploy/compose/.env.aws.example`](../../deploy/compose/.env.aws.example) to `.env.aws` and
fill it from `terraform output`. Add `http://localhost:3630` to `media_cors_extra_origins`.

## Tearing down

`aws-dev` has no deletion protection:
`terraform -chdir=infra/terraform/envs/aws-dev destroy`. `aws-prod` refuses until you set
`deletion_protection = false` in its `main.tf`, apply, and empty the bucket. Secrets have a 30-day recovery window in
`aws-prod`.
