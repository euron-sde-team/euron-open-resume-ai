# ADR 0008: PDFs from headless Chromium with JavaScript off and no network

## Status

Accepted.

## Context

PDF export has to look like the preview, which is HTML and CSS in 13 templates
([ADR 0004](0004-server-rendered-templates-and-previews.md)). The most faithful way to turn that
into a PDF is a browser's print engine. A browser rendering untrusted content is also the
largest attack surface in the system: a resume can contain an `<img>` with a URL, a stylesheet
`@import`, a link, and any text a model or a user wrote. Without precautions, that is a server-side
request forgery primitive ("render this URL from inside the VPC"), a tracking pixel, a way to
read local files, and a path to run script.

## Decision

- Render with **headless Chromium through `puppeteer-core`**, which bundles no browser: the binary
  comes from `CHROMIUM_PATH`, or a known system location, or (development) the Playwright cache
  ([`render/pdf.ts`](../../../apps/api/src/services/resume/render/pdf.ts)). The images install
  the Debian `chromium` package with Noto and Liberation fonts so every script prints.
- **JavaScript is disabled** for the page.
- **The network is blocked.** Request interception is on, and every request whose URL does not
  start with `data:` or `about:` is aborted. The page is loaded with `setContent`, so there is no
  origin to navigate from.
- **Nothing needs the network.** FontAwesome and the bundled fonts are inlined as base64, the
  document carries a CSP (`default-src 'none'; style-src 'unsafe-inline'; img-src data:;
  font-src data:`), and images are `data:` URLs only.
- **One long-lived browser per process**, a small concurrency limiter (`PDF_CONCURRENCY`, default
  2), a bounded queue of 25 waiting renders, 20 s to load and 30 s to print, and a restart after
  `PDF_RECYCLE_PAGES` pages (default 100) because Chromium leaks memory.
- **Chromium's own sandbox is on** unless `CHROMIUM_NO_SANDBOX=1`. The container images set it
  because a user-namespace sandbox is not available inside a container; the network block is the
  compensating control, along with the non-root user and the read-only root filesystem on Fargate.
- A cover letter and a resume go through the same function. DOCX does not touch Chromium.
- PDFs render in the **API process**, on request, because the user is waiting for the file.

## Consequences

Positive:

- The PDF matches the preview, including fonts and print backgrounds.
- A hostile resume cannot make the server fetch anything: there is no network from the page and
  nothing in the document asks for one.
- Rendering is stateless and needs no file system beyond Chromium's own profile directory.

Trade-offs:

- The image ships Chromium and its fonts, and the API task needs memory headroom for it (the
  default Fargate size is 2 GB, and the local compose stack gives the API 1.5 GB).
- Every PDF is a render in a request, so a spike of exports competes with API traffic. The
  limiter, the queue cap and the per-user rate limit (40 downloads or 20 exports a minute) bound
  it; a full queue returns an error.
- With the sandbox off in containers, the defence depends on the network block and on Chromium
  having no vulnerability that escapes JavaScript-off rendering of `data:` content.
- If Chromium is missing, PDFs are unavailable; the builder export answers 503, and the resume
  download currently answers a generic 500 (security.md gap 4).

## Alternatives considered

- **A hosted HTML-to-PDF service.** Sends resumes to a third party, which this product avoids by
  default.
- **A pure-JS PDF library** (pdfkit, pdf-lib). No browser, but a second layout engine and a second
  set of templates, which would drift from the preview.
- **Allow the network and an allow-list.** More flexible, and a permanent SSRF review item.
- **Render in the worker through a queue.** Isolates load, but adds latency and a polling loop to
  something the user is waiting on. A later option if PDF load grows.
