# Architecture decision records

Short records of the decisions that shape Euron Open Resume AI: the context, what was
decided, and what it costs. The system as built is described in [HLD.md](../HLD.md) and
[LLD.md](../LLD.md).

| ADR | Decision |
| --- | --- |
| [0001](0001-single-deployment.md) | One organisation per deployment; no tenants |
| [0002](0002-offline-engine-as-default-ai.md) | A deterministic offline engine answers every AI task until a provider is configured |
| [0003](0003-admin-quotas-without-billing.md) | Monthly AI-run allowances from admin-managed tiers; counted in PostgreSQL; no billing |
| [0004](0004-server-rendered-templates-and-previews.md) | Server-rendered EJS templates are the single source for the preview and the PDF |
| [0005](0005-canonical-resume-document.md) | One canonical `ResumeDocument` is the only resume shape the system moves around |
| [0006](0006-component-table-pipeline.md) | A component table with per-row state instead of per-feature status columns |
| [0007](0007-uploads-through-the-api-only.md) | Resume uploads pass through the API, which validates before it stores |
| [0008](0008-chromium-with-no-network-for-pdfs.md) | PDFs come from headless Chromium with JavaScript off and no network |
| [0009](0009-sql-migrations-with-kysely-types.md) | Plain SQL migrations, a small forward-only runner, and Kysely types generated from the database |
| [0010](0010-floci-for-local-aws.md) | Floci as the local AWS, provisioned by the production Terraform modules |

Each record has a status. **Accepted** means the code does it today.
