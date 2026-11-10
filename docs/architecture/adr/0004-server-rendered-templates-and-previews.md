# ADR 0004: Server-rendered templates; one source for preview, PDF and DOCX look

## Status

Accepted.

## Context

A resume product has to show a resume in 13 different looks, let people see the result as they
edit, and export it as a PDF and a Word file. The usual ways to build this duplicate the work:
React components for the screen, a separate print stylesheet or a second template set for the
PDF, a third description for Word. Each copy drifts, and what the user sees is not what they
download. The content is also untrusted: it comes from an upload, a model or a pasted JSON
document, and it carries links and an image.

## Decision

- The 13 looks are **EJS templates on the server** ([`apps/api/src/templates`](../../../apps/api/src/templates)).
  A template is a function of one data object and returns one self-contained HTML document:
  inline CSS, FontAwesome and the two bundled fonts inlined as base64, a CSP meta tag, no
  script and no network need ([`render/html.ts`](../../../apps/api/src/services/resume/render/html.ts)).
- **The preview is that HTML.** The API returns it (`POST /api/builder/render`,
  `GET /api/resumes/:id/render`) and the web app shows it in an iframe with an empty `sandbox`
  and `srcdoc`. There is no React copy of any template.
- **The PDF is that HTML printed** by a locked-down Chromium ([ADR 0008](0008-chromium-with-no-network-for-pdfs.md)).
  What you see in the preview is what the PDF contains, apart from print media rules.
- **The DOCX is built separately** from the same canonical document with the `docx` library
  ([ADR 0005](0005-canonical-resume-document.md)). Word has no HTML renderer worth trusting, so a
  table-driven builder with three layouts (`modern`, `classic`, `compact`), one per template
  family, gives a document that opens the same in Word, LibreOffice and Google Docs. It matches
  the family, not the pixels.
- A template id is only ever a key into an allow-list ([`registry.ts`](../../../apps/api/src/services/resume/render/registry.ts)),
  never part of a path. All output is HTML-escaped, and links pass `safeHref`.
- The templates read a legacy-shaped object. A **mapper** converts the canonical document to
  it ([`mapper.ts`](../../../apps/api/src/services/resume/render/mapper.ts)), so templates
  can be added or ported without touching the data model.

## Consequences

Positive:

- One source of truth for how a resume looks on screen and on paper. A change to a template
  changes both.
- No template code ships to the browser, and the browser never interprets resume content as
  markup: the iframe is sandboxed and the document has its own CSP.
- Previews, PDFs and the template-preview images all use the same renderer and the same safety
  filters.
- Adding a template is adding one `.ejs` file and one registry entry.

Trade-offs:

- Every preview is a round trip (`120` per minute per user, debounced 450 ms in the builder).
  It is not an instant local render.
- The preview is laid out at 816 px wide while the templates declare A4; it is scaled to fit,
  not an exact page.
- The HTML templates do not render the profile photo; the DOCX does.
- The templates use a legacy data shape, which the mapper has to keep alive.
- DOCX and PDF can differ in detail.

## Alternatives considered

- **React template components, printed with the browser's print dialog.** Instant previews and
  one language, but a client-side PDF is at the mercy of the user's browser, templates ship to
  every client, and resume content would be interpreted in the app's origin.
- **A second server template set for the PDF.** Two sources that drift.
- **LaTeX.** Excellent typography, a heavy toolchain, hard to sandbox and to give the user a
  live preview.
- **Converting HTML to DOCX.** Existing converters give poor Word output for table-heavy layouts.
