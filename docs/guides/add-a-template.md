# Add a template

A resume template is one EJS file plus an entry in the template registry. This guide adds a
fourteenth one end to end. The rendering design is in
[rendering-and-templates.md](../architecture/rendering-and-templates.md); this page is the
checklist.

Throughout, the new template is called `sunrise_resume_template`. Template ids are
lowercase words ending in `_template` (the existing ones are `resume_template`,
`modern_resume_template`, `entry_level_template`, and so on).

## How a template is used

```
ResumeDocument ──mapper.ts──▶ data.updatedResume ──EJS──▶ HTML ──▶ preview (iframe)
                                                              ├──▶ Chromium ──▶ PDF
                                                              └── (DOCX is built separately, from the document)
```

- The **document** is the canonical `ResumeDocument` (`packages/types`).
- [`render/mapper.ts`](../../apps/api/src/services/resume/render/mapper.ts) reshapes it into
  the object every template receives as `data.updatedResume`. It is tolerant: a section it
  cannot read becomes empty, never an error.
- [`render/html.ts`](../../apps/api/src/services/resume/render/html.ts) compiles the file once
  and renders it with `{ data, safeHref }` in scope, then injects the Content-Security-Policy
  meta tag, the Font Awesome subset and any bundled fonts.
- [`render/pdf.ts`](../../apps/api/src/services/resume/render/pdf.ts) prints the same HTML to
  A4 PDF in headless Chromium, with JavaScript off and every request except `data:` and
  `about:` blocked.
- The **DOCX** export does not use your EJS: [`render/docx.ts`](../../apps/api/src/services/resume/render/docx.ts)
  builds it with the `docx` library in one of three layouts (`modern`, `classic`,
  `compact`), chosen by the `docx` field of your registry entry.

## 1. Write the EJS file

Create `apps/api/src/templates/sunrise_resume_template.ejs`. The easiest start is to copy
the existing template closest to what you want (`resume_template.ejs` for a single column,
`multi_column_resume_template.ejs` for a sidebar) and change the markup and CSS.

Rules every template follows (the tests enforce most of them):

- **A self-contained page.** Inline `<style>` only. No `<script>`, no `<link>`, no
  `@import`, no web fonts from a CDN, no remote images. Icons come from the Font Awesome
  subset the renderer injects; the bundled faces are Lato and Merriweather (declare them in
  `fonts` in step 2, then use them in `font-family`).
- **A4 print setup.** `@page { size: A4; margin: ... }` and an `@media print` block, as in
  the existing templates. The resume may run to more than one page.
- **Output escaping.** Use `<%= value %>` (escaped) for every value. Never `<%- value %>`
  for resume data: the test sends `<b>Lovelace</b>` as a name and expects `&lt;b&gt;` back.
- **Links through `safeHref`.** `<a href="<%= safeHref(url) %>">`. It allows only `http`,
  `https`, `mailto` and `tel` and turns anything else (`javascript:`, `data:`) into `#`.
  The email and phone links in the existing templates are built from escaped fields.
- **Guard optional fields.** Render a section only when it has content, like
  `<% if (data.updatedResume.education && data.updatedResume.education.length > 0) { %>`.

The data your template reads, from `toTemplateResume` in the mapper:

| Path under `data.updatedResume` | Shape |
| --- | --- |
| `personalInfo` | `{ name, email, phone, location, title, links[] }` (`links` are URL strings) |
| `summary` | string |
| `skills` | string array (groups flattened, deduplicated) |
| `coreCompetencies` | array (empty today) |
| `languages` | `[{ name, level }]` |
| `experience` | `[{ companyName, designation, duration, location, description: [{ point }] }]` |
| `education` | `[{ degree, institution, duration, location, description }]` |
| `projects` | `[{ name, duration, link, technologiesUsed[], description: [{ point }] }]` |
| `achievements` | `[{ name, link, date }]` (certifications ride along as achievements) |

The cover letter has its own file, `cover_letter.ejs`, shared by every resume template; a
new resume template does not need one.

## 2. Register it

Three edits make the id real and typed:

1. **`packages/types/src/resume.ts`**: add `"sunrise_resume_template"` to `TEMPLATE_IDS`. The
   union `TemplateId` and every `z.enum(TEMPLATE_IDS)` in the API follow.
2. **`apps/api/src/services/resume/render/registry.ts`**: add an entry to `TEMPLATE_SPECS`.
   It is a `Record<TemplateId, ...>`, so TypeScript fails until you do.

   ```ts
   sunrise_resume_template: {
     name: "Sunrise",                      // shown in the chooser
     description: "One sentence on the look and who it suits.",
     columns: 1,                           // 1 or 2
     accent: "#ea580c",                    // the chooser's swatch colour
     atsFriendly: true,                    // true only for a plain single-column flow
     docx: "modern",                       // DOCX layout: "modern" | "classic" | "compact"
     fonts: ["lato"],                      // optional: bundled faces to inline
   },
   ```

   `atsFriendly` is a promise to the user: set it only if parsers will read the page in
   order, which means no sidebar, no text inside images and no table layout.
3. **`packages/samples/scripts/validate.mjs`**: this script carries its own copy of the id
   list (`TEMPLATES`, line 10). Add the id there, or `pnpm --filter @open-resume/samples
   validate` rejects any sample that suggests it. Nothing needs to change in
   `generate.mjs` unless you want samples to suggest the new template.

No migration is needed: `resumes.template_id` and `resume_drafts.template_id` are plain
text columns defaulting to `modern_resume_template`. An unknown or missing id always falls
back to the default through `resolveTemplateId` (an allow-list lookup; an id is never used
as a path).

## 3. The picker and the API follow

`GET /api/templates` returns `listTemplateInfo()` (id, name, description, columns, accent,
`atsFriendly`), and the web chooser draws its tiles from it, so nothing in `apps/web` lists
templates by hand. The tile thumbnail is a PNG at `/templates/<id>.png`; a missing file shows
a tile with the template's initial, but you should generate it (next step).

## 4. Generate the preview image

```bash
pnpm --filter @open-resume/api templates:previews
```

[`scripts/template-previews.ts`](../../apps/api/scripts/template-previews.ts) renders every
template with the fullest sample that fits one page to
`apps/web/public/templates/<id>.png` (A4 ratio, 420 px wide). It needs a Chromium (found
automatically, or `CHROMIUM_PATH`). The output is deterministic, so the PNGs are committed;
commit the new one and expect unchanged files to stay unchanged.

## 5. Test it

The existing suites already loop over `TEMPLATE_IDS`, so a new id is covered the moment it is
registered. Run them:

```bash
pnpm --filter @open-resume/api test            # unit tests, including render.test.ts
pnpm --filter @open-resume/samples validate    # sample suggestions are valid ids
make test-integration                          # export and render routes
```

[`render.test.ts`](../../apps/api/test/unit/render.test.ts) checks, for every template:

| Check | What fails it |
| --- | --- |
| Escaping | An unescaped field (`<%-`), found by a name like `<b>Lovelace</b>` |
| Safe output | `<script`, `javascript:`, an `href` or `src` to an external host, a `<link>` to `http`, `@import` or a font CDN |
| CSP | The page must carry the Content-Security-Policy meta tag (the renderer injects it if there is a `<head>`) |
| A real sample | The page renders to more than 5,000 characters with a sample resume |
| PDF | Every template prints to a PDF that starts with `%PDF` and contains the name (needs Chromium) |

Add a template-specific case to that file only when yours does something unusual (a
two-column grid that must not split a job across pages, for example). Look at the PDF
yourself too: open the preview in the app (`/resumes/<id>`, **Improved resume**), pick the
template, and download the PDF and DOCX.

## 6. Ship it

- Run `pnpm lint typecheck test build`, then `make sanitize`.
- The Docker image copies `apps/api/src/templates` to `dist/templates`; nothing else to
  change. Locally `TEMPLATES_DIR` can point elsewhere.
- If the count of templates is mentioned in the README or the walkthrough, update it.
- Note the addition in `CHANGELOG.md`.
