# ADR 0001: One organisation per deployment

## Status

Accepted.

## Context

Resume tools are usually offered as a multi-tenant service: many organisations, one database,
a tenant column on every table. That model needs tenant isolation in every query, per-tenant
configuration, per-tenant billing and a way to run support across tenants. The people who
want to self-host a resume assistant are a career centre, a bootcamp, a company's people team
or a community. Each has one set of users, one admin team and one budget.

## Decision

- A deployment serves **one organisation or community**. There is no `tenant_id` and no
  organisation table. The schema header says so
  ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)).
- Isolation between **people** is enforced by ownership: every resume, component and draft
  row has `user_id`, and every query filters on it ([`resume.repository.ts`](../../../apps/api/src/repositories/resume.repository.ts)
  `findOwned`). A foreign id is a 404.
- There are two roles. `USER` owns their data. `ADMIN` runs the deployment from `/admin` in
  the same web app (accounts, quota tiers, providers and models, settings, audit) and cannot
  read anyone's resumes.
- Deployment-wide behaviour is one settings document (`settings.key = 'app'`): the product
  name, tagline, registration mode (`OPEN`, `INVITE_ONLY` by email domain, `CLOSED`) and a few
  public facts.
- Many organisations means many deployments. The Terraform modules and the compose stack
  stand one up with a handful of variables.

## Consequences

Positive:

- Every query is simpler, and there is one class of authorisation bug to look for (a missing
  `user_id`) instead of two (a missing `user_id` or `tenant_id`).
- No cross-tenant data path exists, so no cross-tenant leak is possible by construction.
- Configuration, quotas and providers are the operator's own; nothing is shared with another
  organisation.
- The data model is small enough to read in one sitting ([data-model.md](../data-model.md)).

Trade-offs:

- Running ten organisations means running ten stacks. There is no shared control plane and no
  cross-deployment reporting.
- Moving to multi-tenancy later means adding a tenant key to every table and every query.
  That is a rewrite of the repository layer, not a flag.
- Per-organisation branding is limited to the app name and tagline in settings.

## Alternatives considered

- **A tenant column on every table.** The standard SaaS shape. Rejected because the intended
  operators have one organisation, and the cost (a filter on every query, a tenant concept in
  every API) buys nothing for them.
- **A database or schema per tenant.** Strong isolation inside one deployment, but it needs a
  provisioning layer, per-tenant migrations and a router. More machinery than ten small
  deployments.
