# ADR 0010: Floci as the local AWS, provisioned by the production Terraform modules

## Status

Accepted.

## Context

The deployed system uses S3 (private, SSE-KMS), SES, Secrets Manager and KMS. A developer running
the stack locally needs the same code paths, or the paths that matter (uploads to a bucket,
mail through SES) are only exercised in production. Local alternatives each fake one service
(MinIO for S3, a mail catcher for mail) and leave the Terraform that provisions production
untested until a deploy.

## Decision

- Local development runs on **Floci**, an MIT-licensed AWS emulator
  ([`deploy/compose/compose.floci.yaml`](../../../deploy/compose/compose.floci.yaml)), pinned to a
  version, with persistent storage.
- A **`terraform` one-shot** applies [`infra/terraform/envs/local-floci`](../../../infra/terraform/envs/local-floci/main.tf)
  against the emulator before anything that needs it starts. That environment uses **the same modules
  that build production** (`kms`, `storage`, `secrets`, `email`); only the provider endpoints
  differ. Terraform state lives in a volume that shares the emulator's lifecycle.
- The API then uses `STORAGE=s3` and `MAIL_MODE=ses` exactly as on AWS. The browser-reachable S3
  address is `S3_PUBLIC_ENDPOINT`; the API talks to the emulator over the compose network. SES
  relays to **Mailpit**, so mail can be read in a browser.
- **Redis stays a plain container**: the emulator's ElastiCache control plane would need Docker
  socket access to back a real cache, which is not worth mounting.
- The base compose file alone keeps media on a volume (`STORAGE=local`) and mail on Mailpit over
  SMTP; `make up-aws` pairs it with real AWS resources instead.
- The integration suite runs the **backend matrix**: `STORAGE` (local, s3) by `MAIL_MODE` (outbox,
  smtp, ses), six runs against the local stack ([`scripts/test-matrix.sh`](../../../scripts/test-matrix.sh)).
- The model provider is a **stub**, not Floci: [`apps/stubs`](../../../apps/stubs/server.mjs).

## Consequences

Positive:

- Local runs exercise S3, KMS, Secrets Manager, SES and the Terraform modules, with no AWS account.
- A change to a module is validated locally before it reaches an environment.
- The matrix proves the storage and mail backends behave the same.
- `make up` is one command from a clean checkout.

Trade-offs:

- An emulator is not AWS. Edge cases (IAM evaluation, eventual consistency, SES sandbox rules) are
  not reproduced, so a real deploy still needs a smoke test.
- One more container to run and one more version to pin. Floci is a younger project than the
  alternatives.
- ElastiCache, ECS, RDS, the load balancer and CloudFront are not emulated here; Redis and
  Postgres are plain containers and the edge is the web app's proxy.

## Alternatives considered

- **LocalStack.** The established emulator. Floci is MIT licensed and covers the services used
  here (S3, KMS, Secrets Manager, SES, Route 53), which suited an open-source repository.
- **MinIO plus a mail catcher.** Simple, but leaves KMS, Secrets Manager and the Terraform modules
  untested and the code on a different storage client path.
- **Real AWS for development.** Costs money, needs credentials on every laptop and makes tests slow
  and shared.
