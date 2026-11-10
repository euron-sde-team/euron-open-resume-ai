# ADR 0007: Resume uploads pass through the API, which validates before it stores

## Status

Accepted.

## Context

The production system this was extracted from let the browser choose where an upload was
stored (a client-supplied bucket, key or URL), which is the weakness this decision removes. A resume upload carries three questions that must be
answered *before* anything is kept or any money is spent: is it a file we can read, is it
within this user's limit and quota, and where may it be written. When the browser talks to
object storage directly (a presigned URL, a client-chosen key), the answers come late, the
client holds a credential or a URL, and a bad or hostile file sits in the bucket until
something finds it.

A resume is also small (10 MB at most), which removes the usual reason for direct upload
(large media).

## Decision

- The browser sends **one multipart request to the API** (`POST /api/resumes`, or
  `POST /api/builder/import`). The API reads the file into memory, bounded by the smaller of
  the user's tier limit and 10 MB, one file, a few small fields
  ([`middleware/multipart.ts`](../../../apps/api/src/middleware/multipart.ts)).
- **The API decides what the file is from its bytes**, never from the client's content type
  ([`extract.ts`](../../../apps/api/src/services/resume/extract.ts) `sniffFile`): `%PDF-`, a zip
  with `word/document.xml`, or UTF-8 text with a `.txt` or `.md` name. Anything else is
  `415 UNSUPPORTED_FILE`.
- **It extracts the text before charging.** A scan or an image-only file is `422 NO_TEXT`, and
  nothing is charged or stored.
- **Then, in order:** check the resume slot and the month's runs, charge the run, write the
  object under a server-built key (`resumes/<user>/<resume>/original.<ext>`, with the sniffed
  type as its content type), insert the rows in one transaction, enqueue after commit. Every
  failure on that path undoes what was done: refund the run, delete the object.
- **The client never supplies a key, a path or a URL.** Its file name is cleaned to a base name
  and kept only as a label. The original is served back only through
  `GET /api/resumes/:id/download/original`, owner-scoped, `attachment`, `no-store`.
- Queue jobs carry ids; the worker reads the file from storage by the key on the resume row.
- The bucket is private, SSE-KMS, with no public access. No credential or presigned URL ever
  reaches the browser for resumes.

## Consequences

Positive:

- Validation, limits and charging happen before anything is stored. A rejected file leaves no
  object and no charge.
- There is no client-chosen key to traverse or overwrite, and no URL to leak.
- One request, one error model, one place to add a check (a virus scan, a new type).
- The same code path serves local disk and S3, so tests cover both.

Trade-offs:

- The API holds the file in memory while it validates and stores it: 10 MB at a time, bounded
  by the limit and by rate limits (20 uploads an hour). It cannot scale to large media, and does
  not need to.
- Parsing happens in the API process on untrusted bytes (`unpdf`, `mammoth`), and again in the
  worker. See [security.md](../security.md#known-gaps), gap 6.
- Upload progress in the browser is the API's, not S3's. For a 10 MB file that is fine.
- The storage interface still carries presigned-URL helpers and a local signed-GET route that
  the resume flow does not use (gap 13).

## Alternatives considered

- **Presigned PUT straight to S3, then a "complete" call.** The standard pattern for large
  files. It moves validation after storage, gives the client a write credential and a chosen
  object name, and needs a cleanup job for abandoned objects. Not worth it at 10 MB.
- **A public bucket with unguessable keys.** Secrecy by obscurity; one leaked URL is permanent.
- **Streaming the upload straight into the parser.** Saves memory, but the file must also be
  stored and re-read by the worker, and the size cap must be enforced before parsing anyway.
