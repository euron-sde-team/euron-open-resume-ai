# ADR 0005: One canonical ResumeDocument

## Status

Accepted.

## Context

A resume passes through many hands: the chat builder edits it, a parser turns an uploaded file
into it, a model rewrites it, drafts store it half-finished, templates render it, the DOCX
builder reads it, the export returns it. If each of those has its own shape, every pair needs
a converter, and every converter is a place to lose a field or let an unsafe value through.
Resumes are also untrusted input: the data may come from a model, a parser or a pasted JSON.

## Decision

- **One shape**, `ResumeDocument`, defined once in
  [`packages/types/src/resume.ts`](../../../packages/types/src/resume.ts): `personal`, `links`,
  `summary`, `experience`, `education`, `skills`, `projects`, `certifications`, `languages`,
  `achievements`. Every field is optional.
- **A tolerant normaliser at every entry.** A zod schema ([`ai/document.ts`](../../../apps/api/src/services/resume/ai/document.ts)
  `documentSchema`) trims strings, strips control characters (a NUL breaks JSONB), caps string
  lengths and list sizes, drops empty entries and unknown keys, accepts a lone string where a
  list is expected, keeps links only as `http`, `https`, `mailto` or `tel` URLs, and keeps the
  photo only as a `png`, `jpeg` or `gif` data URL. It truncates instead of rejecting, and never
  throws.
- **Stored whole as JSONB** in `resumes.original`, `resumes.improved` and
  `resume_drafts.document`. Nothing queries inside a document; it is read and written as a unit,
  so a relational breakdown would add joins and migrations without a query to serve.
- **The same type crosses every boundary**: the API request bodies, the model's output (validated
  by the same schema), the stored rows, the templates (through the mapper), the DOCX builder and
  the web app (through the shared types package).
- The owner's contact details and photo are restored from the original after a model rewrite
  (`restoreOwnerFields`), so a model cannot change whose resume it is.

## Consequences

Positive:

- One place to add a field, and the compiler finds every caller through the shared package.
- Safety is applied once, at the door, rather than in each consumer. Everything downstream can
  assume a bounded, filtered document.
- Documents are portable: the data export and the builder import use the same shape.

Trade-offs:

- JSONB is validated by zod, not by the database. A bad write through a path that skips the
  normaliser would not be caught by Postgres.
- Tolerance hides bad model output by truncating it. The task schemas (analysis, interview and
  so on) are stricter and drive the repair retry; the document schema is the permissive one.
- Today two normalisers exist with slightly different caps (`ai/document.ts` and
  `resume/document.ts`). They should be merged ([security.md](../security.md#known-gaps)).
- A field added to the type must be added to the normaliser, the mapper and the DOCX builder.

## Alternatives considered

- **A relational model** (a table per section). Queryable, but nothing needs the queries, and the
  AI tasks, the templates and the builder all want the whole document at once.
- **Per-consumer shapes** (a template shape, a model shape, a storage shape). Converters
  everywhere, and unsafe values slip through the gaps between them.
- **Strict validation that rejects bad documents.** Would make the upload and rewrite paths
  brittle against messy real-world resumes and model output.
