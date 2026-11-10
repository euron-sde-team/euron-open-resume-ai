# Walkthrough

A tour of every screen and flow, first as a member, then as an administrator, with the demo
accounts from [quickstart-local.md](quickstart-local.md#seed-the-demo). Start the stack
(`make up`, `make demo`) and open http://localhost:3630. Every demo account signs in with
the password `make demo` prints.

## As a member

Sign in as `priya.nair@example.com`. The app opens on **Resumes** (`/`, which redirects to
`/resumes`). The sidebar has three entries: **Resumes**, **Builder** and **Samples**; the
account menu holds Settings, the theme (light, dark, system) and sign out.

### Sign up, sign in, recover

| Screen | Path | What it does |
| --- | --- | --- |
| Sign up | `/signup` | Email, username, display name and a password of 10 to 128 characters. Guessable passwords and passwords containing your email name are refused. With email verification on (the default) the page says to check your email |
| Verify email | `/verify-email?token=...` | The link in the mail; verifying signs you in |
| Sign in | `/login` | Email or username plus password. With two-factor on, a second step asks for the 6-digit code or one recovery code |
| Forgot / reset password | `/forgot-password`, `/reset-password` | Always answers "if the address exists"; a successful reset signs every session out |
| Goodbye | `/goodbye` | Shown after you delete your account |

Locally every message arrives in Mailpit at http://localhost:8106. Sign-in failures are
throttled (5 per account and IP per 15 minutes, then a 429 for everyone alike).

### Upload a resume

**Resumes** shows your list. Press **Upload a resume** (`/resumes/new`); **Builder** is the other way in.

1. Drop a **PDF, DOCX, TXT or Markdown** file. The page checks the type and the size against
   your tier (`maxUploadMb`, never above 10 MB); the API checks them again and sniffs the
   real file type from its first bytes, so a renamed file is refused.
2. Optionally fill **Company** and **Job description**. With a job description the analysis
   reports missing keywords and the improved resume and cover letter are written for that
   role.
3. Submit. The API answers `202`, stores the file, charges one AI run and queues the
   analysis. The page follows the status until it is done.

What the pipeline does ([`pipeline.ts`](../../apps/api/src/services/resume/pipeline.ts)):
extracts the text, parses it into a structured document, then one **analysis** job produces
the report (score before and after, summary, strengths and weaknesses, keywords, formatting
and readability notes), the **improved resume** and the **cover letter**. A second job, the
non-technical **interview** set, rides on the same run. If the file is a scan or an image the
upload is refused with a plain message and no run is used.

The other components are on demand and cost one run each: the three technical interview
tracks (DSA, Programming, System design), the **roadmap** and **project ideas**.

### The report

Open a resume (`/resumes/<id>`). The title, status and the tabs:

| Tab | Shows |
| --- | --- |
| **Analysis** | Score before and after, summary, "Fix these first", strengths and weaknesses, keywords found and missing, formatting, content and readability |
| **Improved resume** | A live preview of the rewritten resume, a **template chooser** (13 templates, with thumbnails; the ATS-friendly ones are marked), and PDF and DOCX downloads |
| **Cover letter** | The generated letter, with PDF and DOCX downloads |
| **Interview** | Four tracks as tabs: Non-technical, DSA, Programming, System design. The first is generated with the analysis; the others have a **Generate** button |
| **Roadmap** | Career roadmap and certifications to consider, generated on demand |
| **Projects** | Project ideas, generated on demand |
| **Tailor** | Paste a different **Job description** (and **Company**) to produce a new version of this resume for that role; it appears in your list as its own resume |

Each component has its own state (`pending`, `queued`, `processing`, `done`, `failed`,
`skipped`), so one failure is local: a failed component shows its message and a **Retry**.
A run charged for work that failed on our side is refunded automatically.

Try with Priya's resumes first; they are real pipeline output from the offline engine. Then
upload your own and compare.

### Build a resume with the chat builder

**Builder** (`/builder`) is a two-pane screen: a chat on one side, the live preview on the
other.

- Describe your background in the chat; the assistant asks follow-up questions and fills the
  document. Each message costs one AI run. You can also **import** an existing file into the
  builder (up to 10 MB).
- Edit any section by hand in the editor; the preview re-renders as you type (the render
  endpoint is cheap and not charged).
- Pick a template, and download PDF or DOCX at any time.
- **Save** keeps a draft (up to 50 per account). **Drafts** reopens them.
- **Analyse** turns the document into a resume with the full pipeline (one run), after which
  it appears in your list with a report like an uploaded one.

### Samples

**Samples** (`/samples`) lists 60 fictional resumes by role, field and level, searchable by
role, field or skill. Preview any of them in its suggested template and use one as the
starting point for the builder.

### Settings

`/settings` has your **Theme**, **AI runs this month** (used and limit, with the reset date;
the first of the next UTC month), your display name, and:

- **Security**: change password, set up **two-factor sign-in** (scan the QR code or type the
  secret, confirm with a code, save the ten recovery codes shown once), regenerate recovery
  codes, see **Where you are signed in** and revoke a session, or **sign out everywhere**.
- **Privacy and data**: **Download your data** (a JSON export) and **Delete account**. A
  deleted account is signed out at once and erased after a 14-day grace period; signing in
  again within that period cancels it.

### When the monthly runs are used

Sign in as a user whose tier allows few runs (create a one-run tier in `/admin/quotas`, put a
member on it). The next AI action answers `429` and the app says so plainly, with the reset
date; everything that does not need the AI (editing, previewing, downloading what already
exists) keeps working.

## As an administrator

Sign in as `admin@example.com`. The avatar menu shows **Admin**, which opens `/admin`. An
administrator manages the deployment, and never reads anyone's resumes: no admin endpoint
returns resume content, and a resume id belonging to someone else is a 404 for everyone.

| Page | Path | What you do there |
| --- | --- | --- |
| **Overview** | `/admin` | Sign-ups per day, AI runs per day and by kind (`analyze`, `interview`, `roadmap`, `projects`, `builder`) for a date range of up to 366 days, totals |
| **Users** | `/admin/users` | Search and filter accounts (status, role, tier). Open one for the account facts, tier, own limits, AI runs per month and the **Access** actions: make or remove admin, suspend for a number of days (read-only), ban, unban, erase (with a reason) |
| **Quotas** | `/admin/quotas` | Tiers: name, monthly runs, max resumes, max upload MB (a blank limit means unlimited), one tier is the default. A member without a tier gets the default; a per-user override beats the tier |
| **Models** | `/admin/models` | Providers (slug, kind, base URL, enabled, whether a key is configured) and their models (model id, context window, max output, default, order). **Test** makes one tiny real call and reports the result without echoing keys or provider text |
| **Settings** | `/admin/settings` | App name and tagline, registration (`OPEN`, `INVITE_ONLY` with allowed email domains, `CLOSED`), support email, "House instructions" added to every AI request (up to 4,000 characters), feature flags, minimum supported mobile version, and a read-only **Integrations** panel (mail and storage mode, whether a model is configured) |
| **Audit log** | `/admin/audit` | Every admin action and account event, filterable by action, actor and entity; click an actor or entity to narrow |

Things to try:

1. In **Models**, enable the **Local stub** provider and its model, set it as default, then
   upload a resume: the work now goes through the real provider adapter to `apps/stubs`
   instead of the offline engine. `http://localhost:5199/__/requests` lists what was sent.
2. In **Quotas**, create a tier of 1 run, put Sam on it, sign in as Sam and upload twice.
3. In **Settings**, switch registration to `INVITE_ONLY` with `example.com`, then try to
   sign up with another domain (`REGISTRATION_DOMAIN_NOT_ALLOWED`).
4. In **Users**, suspend Amara for 7 days; she can sign in but nothing can be changed
   (`ACCOUNT_RESTRICTED`). Open **Audit log** to see the entries.

## Where each flow lives

| Flow | Web | API |
| --- | --- | --- |
| Auth | `components/auth` | [`auth.routes.ts`](../../apps/api/src/routes/auth.routes.ts), `auth.service.ts` |
| Upload and report | `components/resume` | [`resumes.routes.ts`](../../apps/api/src/routes/resumes.routes.ts), `services/resume/resume.service.ts`, `pipeline.ts` |
| Builder | `components/resume/builder` | `builder.routes.ts`, `builder-ai.routes.ts`, `drafts.routes.ts` |
| Rendering and export | `PreviewFrame` | `services/resume/render/` |
| Quotas | settings view, `admin/quotas` | `services/quota.service.ts` |
| Admin | `components/admin` | [`admin.routes.ts`](../../apps/api/src/routes/admin.routes.ts) |

The design of each is in [architecture/](../architecture/HLD.md); the HTTP surface is in
[api.md](api.md).
