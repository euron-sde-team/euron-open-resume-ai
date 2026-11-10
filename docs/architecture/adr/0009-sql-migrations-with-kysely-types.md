# ADR 0009: Plain SQL migrations, a small runner, and Kysely types from the database

## Status

Accepted.

## Context

The schema has real constraints: partial unique indexes ("exactly one default tier"), `citext`,
`pg_trgm` GIN indexes, `CHECK` lengths, composite keys, enums. The queries are ordinary but need
control: `UPDATE ... WHERE` claims, upserts with conditions, advisory locks, keyset cursors with
exact timestamps. An ORM that models the schema in its own language tends to hide or fight these
features, and a migration tool that diffs models into SQL can generate surprises.

## Decision

- **Migrations are plain SQL files**, `db/migrations/NNNN_name.sql`, written by hand and reviewed
  as SQL ([`0001_init.sql`](../../../db/migrations/0001_init.sql),
  [`0002_resumes.sql`](../../../db/migrations/0002_resumes.sql)).
- **A small forward-only runner** ([`db/migrate.ts`](../../../db/migrate.ts)) applies pending files
  in filename order, each in its own transaction, records each in `schema_migrations` with a
  SHA-256, and **refuses to continue if an applied file was edited** (add a new file instead).
  A Postgres advisory lock serialises concurrent runs, so two API tasks booting at once, or a
  deploy racing a boot, are safe. There are no down migrations.
- The runner runs as a one-off task (`node dist/migrate.js`, `make aws-migrate`) or on boot with
  `MIGRATE_ON_BOOT`; the local stack runs it as a one-shot service before the API and worker start.
- **Runtime queries use Kysely**, a typed query builder, with row types **generated from the
  live database** by `kysely-codegen` (`pnpm --filter @open-resume/api db:types`), then patched
  so `int8` and `numeric` are numbers (the pool parses them as numbers)
  ([`scripts/patch-db-types.mjs`](../../../apps/api/scripts/patch-db-types.mjs)). The migration is
  the source of truth; the types follow it.
- Repositories take an optional `Executor` (the database or a transaction), so the same method
  runs inside or outside a transaction.
- Enum types and `citext[]` arrays are registered with the driver at boot (`initDbTypes`).

## Consequences

Positive:

- The schema is exactly what the SQL says, including features ORMs do not model.
- Queries are SQL-shaped and typed, so a renamed column is a compile error.
- Idempotent concurrent claims and advisory locks are first-class, not workarounds.
- The checksum catches an edited migration before it causes drift between environments.

Trade-offs:

- Writing SQL by hand takes more care than a diffing tool and gives no automatic rollbacks. A bad
  migration is fixed forward.
- Types must be regenerated after a migration; a stale `types.ts` is a typecheck problem, not a
  runtime one.
- The generated file is large and is committed, so reviews see its changes.
- Two numeric types are patched after generation.

## Alternatives considered

- **Prisma.** Schema and migrations in one DSL, with a generated client. Partial indexes, `citext`
  and some Postgres features need raw SQL anyway, and conditional upserts are awkward.
- **TypeORM or Sequelize.** Active-record models and migrations in TypeScript; more magic than the
  queries here want.
- **Raw `pg` with hand-written types.** Maximum control, no help from the compiler.
- **Down migrations.** Rarely run correctly in production and double the surface to review.
