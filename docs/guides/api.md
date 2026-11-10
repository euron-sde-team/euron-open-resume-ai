# HTTP API

An overview of the API by area, how authentication works, every error code, and curl
examples. The complete, generated reference (77 operations, with request and response
shapes) is [`docs/api/openapi.yaml`](../api/openapi.yaml); the typed DTOs are in
[`packages/types`](../../packages/types/src), and a typed client in
[`packages/api-client`](../../packages/api-client/src).

Base URL: `http://localhost:5106/api` directly, or `http://localhost:3630/api` through the web
app's proxy (what the browser uses). All bodies are JSON except uploads (multipart) and
downloads. Ids are ULIDs. Lists are cursor-paginated: `{ "items": [...], "nextCursor": "..." | null }`,
with `?limit=` (1 to 100) and `?cursor=`.

## Authentication

```
POST /api/auth/signup  ──▶ 202 { verificationRequired: true }      (email verification on)
                           201 AuthResult                          (verification off)
POST /api/auth/verify-email { token } ──▶ AuthResult               (the link in the mail)
POST /api/auth/login { login, password, totp? | recoveryCode? }
        ──▶ AuthResult + httpOnly cookie  resume_refresh
        ──▶ 200 { totpRequired: true }   when a second factor is needed: send it again with totp
POST /api/auth/refresh   (cookie) ──▶ new AuthResult, cookie rotated; 204 when there is no cookie
POST /api/auth/logout    ──▶ 204
```

- `AuthResult` is `{ accessToken, expiresIn, user }`. Send the token as
  `Authorization: Bearer <accessToken>`. It lives 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`).
- The refresh token is a long-lived (30 days) `httpOnly`, `SameSite=Lax` cookie named
  `resume_refresh`, scoped to `/api/auth`. Every refresh **rotates** it; replaying an old one
  ends the whole session family (`401 SESSION_EXPIRED`).
- **Native clients** send `X-Client: native`: the refresh token comes back in the body
  (`IssuedNativeSession`) and `refresh` and `logout` take `{ "refreshToken": "..." }`. No
  cookie is set.
- `login` accepts the email or the username. Failures are throttled (5 per account and IP per
  15 minutes, 50 per account per hour), then `429 RATE_LIMITED` for everyone alike.
- A non-GET request that carries an `Origin` not listed in `CORS_ORIGINS` is refused with
  `403 CORS_ORIGIN_DENIED`; calls without an `Origin` (curl) are fine.
- Passwords are 10 to 128 characters; `WEAK_PASSWORD` rejects guessable ones.

## Areas

Authentication is "any signed-in account" unless stated. Resource ownership is enforced in
every query: someone else's resume, draft or session is a `404`, never a `403`.

### Auth (`/api/auth`)

| Operation | Notes |
| --- | --- |
| `POST /signup`, `/verify-email`, `/resend-verification` | Public. Sign-up is rate limited (10 per minute per IP); resend 5 per hour |
| `POST /login`, `/refresh`, `/logout` | Public (cookie or native body) |
| `POST /logout-all` | Revokes every session and access token |
| `POST /forgot-password`, `/reset-password` | Public. A reset signs out every session |
| `POST /change-password` | Signed in; needs the current password |
| `GET /me` | The current user |
| `POST /totp/setup`, `/totp/enable`, `/totp/disable`, `/totp/recovery-codes` | Two-factor: setup returns the secret and an `otpauth://` URL, enable returns ten recovery codes once |

### Account (`/api/users`, `/api/me`, `/api/meta`)

| Operation | Notes |
| --- | --- |
| `GET /meta` | Public: app name, tagline, registration mode, feature flags, the default upload limit, support email, minimum mobile version. Never a key or a provider name |
| `GET /users/me`, `PATCH /users/me` | Profile (display name) |
| `DELETE /users/me` | Starts deletion with a 14-day grace period; signing in cancels it |
| `GET /users/me/export` | Your data as JSON (3 per day) |
| `GET /users/me/sessions`, `DELETE /users/me/sessions/:id` | Where you are signed in |
| `GET /me/usage` | This month's runs against the limit, resumes held, upload limit, tier |
| `GET /me/preferences`, `PATCH /me/preferences` | Saved per-account preferences |

### Resumes (`/api/resumes`)

| Operation | Notes |
| --- | --- |
| `POST /` | Multipart upload (field `file`; optional `jd`, `company`, `title`, `templateId`). `202` with the new `ResumeSummary`; one run charged; `415`, `413`, `422` for bad files. 20 per hour |
| `POST /from-document` | JSON `{ document, templateId?, jd?, company?, title? }`: analyse a builder document. `202` |
| `GET /`, `GET /:id` | List (newest first) and detail with each component's state, the analysis, the improved resume and the cover letter |
| `GET /:id/status` | Cheap status poll: overall `status` (`queued`, `processing`, `analyzed`, `error`) and each component (`pending`, `queued`, `processing`, `done`, `failed`, `skipped`) |
| `POST /:id/tailor` | `{ jd, company? }`: a new resume tailored to a job. `202` |
| `POST /:id/components/:kind` | Generate on demand: `interview_non_technical`, `interview_dsa`, `interview_programming`, `interview_system_design`, `roadmap`, `projects`. One run. `202` |
| `POST /:id/retry` | `{ component? }`: retry failed components. `202` |
| `DELETE /:id` | Deletes the resume and its stored file. `204` |
| `GET /:id/download/:what` | `original`, `resume.pdf`, `resume.docx`, `cover-letter.pdf`, `cover-letter.docx`; `?template=<id>` picks a template for the resume files. 40 per minute |
| `GET /:id/render` | The improved resume as HTML for the sandboxed preview iframe; `?template=<id>` |

### Builder (`/api/builder`, `/api/drafts`, `/api/templates`)

| Operation | Notes |
| --- | --- |
| `GET /templates` | The 13 `TemplateInfo` entries (id, name, description, columns, accent, `atsFriendly`) |
| `POST /builder/render` | `{ document, templateId }` to HTML. Free; body up to 512 KB; 120 per minute |
| `POST /builder/export` | `{ document, templateId, format: "pdf" \| "docx" }` to the file. Free; 20 per minute; `503 PDF_UNAVAILABLE` without Chromium |
| `POST /builder/chat` | `{ messages, document? }` to `{ assistant, document, nextPrompts }`. One run per call; 20 per minute |
| `POST /builder/import` | Multipart `file` (up to 10 MB) parsed into `{ assistant, document }`. One run; 6 per minute |
| `GET/POST /drafts`, `GET/PUT/DELETE /drafts/:id` | Saved builder documents, up to 50 per account |

### Admin (`/api/admin`, ADMIN role only)

| Operation | Notes |
| --- | --- |
| `GET /me`, `GET /stats?from=&to=` | Capability check; sign-ups and runs per day, by kind (at most 366 days) |
| `GET /users`, `GET /users/:id` | Search and filter; detail with usage by month |
| `PATCH /users/:id/role`, `POST /users/:id/{suspend,unsuspend,ban,unban,erase}` | Account actions (`erase` needs a reason) |
| `PUT /users/:id/tier`, `PUT/DELETE /users/:id/quota` | Tier and per-user override |
| `GET/POST /tiers`, `PUT/DELETE /tiers/:id` | Quota tiers |
| `GET/POST /providers`, `PUT/DELETE /providers/:id`; `GET/POST /models`, `PUT/DELETE /models/:id` | The model catalogue (keys never appear) |
| `POST /models/:id/test` | One tiny real call; 20 per minute |
| `GET/PATCH /settings`, `GET /integrations` | Deployment settings; what the server is configured with |
| `GET /audit` | The audit trail |

No admin operation returns resume content.

### Health

`GET /up` (process) and `GET /api/ready` (Postgres and Redis) are unauthenticated and not logged.
`GET /api/files/local/:token` serves signed local-storage links when `STORAGE=local`.

## Errors

Every non-2xx response has the same envelope:

```json
{ "error": "Incorrect email or password", "code": "INVALID_CREDENTIALS", "requestId": "01M7..." }
```

`error` is for humans and may change; switch on `code`. `details` is added when there is
more to say, and `requestId` finds the log line. A validation failure lists fields:

```json
{ "error": "username: Required", "code": "VALIDATION_FAILED",
  "details": { "fields": [{ "path": "username", "message": "Required" }] }, "requestId": "..." }
```

Anything unexpected is `500 INTERNAL` with a request id and no internal detail. A
`429 RATE_LIMITED` also sets `Retry-After`.

| Status | Codes |
| --- | --- |
| 400 | `BAD_REQUEST`, `VALIDATION_FAILED`, `WEAK_PASSWORD`, `DISPLAY_NAME_INVALID`, `INVALID_CURSOR`, `TOKEN_INVALID` (emailed link), `INVALID_CREDENTIALS` and `INVALID_TOTP` (password and two-factor confirmations), `TOTP_NOT_STARTED`, `TOTP_NOT_ENABLED`, `TOTP_REQUIRED`, `EXPECTED_MULTIPART`, `BAD_MULTIPART`, `FILE_REQUIRED`, `TOO_MANY_FILES`, `FIELD_TOO_LONG`, `UNKNOWN_TEMPLATE`, `UNKNOWN_COMPONENT`, `RANGE_INVALID`, `RANGE_TOO_LONG`, `DAYS_INVALID`, `SETTINGS_INVALID`, `BASE_URL_REQUIRED`, `BASE_URL_INVALID`, `STUB_IN_PRODUCTION` |
| 401 | `UNAUTHENTICATED` (no token), `TOKEN_INVALID` (expired or revoked access token), `SESSION_EXPIRED` (refresh), `INVALID_CREDENTIALS`, `INVALID_TOTP`, `INVALID_RECOVERY_CODE` (sign-in) |
| 403 | `FORBIDDEN`, `FORBIDDEN_ADMIN`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_RESTRICTED` (suspended: read only), `ACCOUNT_BANNED`, `ACCOUNT_DEACTIVATED`, `REGISTRATION_CLOSED`, `REGISTRATION_DOMAIN_NOT_ALLOWED`, `SELF_ACTION`, `TARGET_PROTECTED`, `CORS_ORIGIN_DENIED`, `FILE_LINK_INVALID` |
| 404 | `NOT_FOUND` (including another account's resource), `USER_NOT_FOUND`, `TIER_NOT_FOUND`, `PROVIDER_NOT_FOUND`, `MODEL_NOT_FOUND` |
| 409 | `CONFLICT`, `EMAIL_TAKEN`, `USERNAME_TAKEN`, `USERNAME_RESERVED`, `TOTP_ALREADY_ENABLED`, `RESUME_LIMIT`, `DRAFT_LIMIT`, `ALREADY_RUNNING`, `NOT_READY`, `NOT_FAILED`, `NOTHING_TO_RETRY`, `FILE_MISSING`, `LAST_ADMIN`, `INVALID_STATUS`, `ALREADY_ERASED`, `USER_ERASED`, `TIER_NAME_TAKEN`, `TIER_IS_DEFAULT`, `PROVIDER_SLUG_TAKEN`, `MODEL_DUPLICATE` |
| 413 | `FILE_TOO_LARGE`, `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_FILE` |
| 422 | `UNPROCESSABLE`, `NO_TEXT`, `UNREADABLE_FILE`, `EMPTY_DOCUMENT` |
| 429 | `RATE_LIMITED`, `QUOTA_EXHAUSTED` (resume routes), `QUOTA_EXCEEDED` (builder routes) |
| 500 | `INTERNAL` |
| 502 / 503 | `AI_BAD_OUTPUT` (502) and `AI_UNAVAILABLE` (503) from the builder; `PDF_UNAVAILABLE` (503) from the builder export |

`TARGET_PROTECTED`/`SELF_ACTION` stop an admin acting on themselves or on the last admin.
`RESUME_LIMIT` is a 409 (the member must delete something). Quota errors carry
`details: { limit, used, resetsAt }`. Failures inside a resume job are not HTTP errors: they
appear as a component with `status: "failed"` and a safe `error` message.

## Examples

Set up once. The local stack has email verification on, so sign up, take the link from Mailpit
(http://localhost:8106) or use a demo account from `make demo`:

```bash
API=http://localhost:5106/api

# Sign in; keep the access token and the refresh cookie
TOKEN=$(curl -s -c jar.txt -X POST $API/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"priya.nair@example.com","password":"<demo password>"}' | jq -r .accessToken)
AUTH="authorization: Bearer $TOKEN"

curl -s $API/auth/me -H "$AUTH"
```

### Sign up

```bash
curl -s -X POST $API/auth/signup -H 'content-type: application/json' -d '{
  "email":"you@example.com","username":"you","displayName":"You","password":"a long passphrase"
}'
# 202 {"verificationRequired":true,...}; the mail has a link /verify-email?token=...
curl -s -X POST $API/auth/verify-email -H 'content-type: application/json' -d '{"token":"<token from the mail>"}'
```

### Upload a resume

```bash
curl -s -X POST $API/resumes -H "$AUTH" \
  -F file=@resume.pdf \
  -F company="Example Corp" \
  -F jd="We are hiring a backend engineer ..."
# 202 {"id":"01...","status":"queued","title":"resume",...}

ID=<the id>
curl -s $API/resumes/$ID/status -H "$AUTH"      # poll until "status":"analyzed" (or "error")
curl -s $API/resumes/$ID -H "$AUTH"             # analysis, improved resume, cover letter
```

### Generate an extra component, tailor, download

```bash
curl -s -X POST $API/resumes/$ID/components/roadmap -H "$AUTH"           # 202, one run
curl -s -X POST $API/resumes/$ID/components/interview_dsa -H "$AUTH"
curl -s -X POST $API/resumes/$ID/tailor -H "$AUTH" -H 'content-type: application/json' \
  -d '{"jd":"Senior platform engineer ...","company":"Another Corp"}'    # 202, a new resume

curl -s -o resume.pdf  "$API/resumes/$ID/download/resume.pdf?template=executive_resume_template" -H "$AUTH"
curl -s -o resume.docx "$API/resumes/$ID/download/resume.docx" -H "$AUTH"
curl -s -o letter.pdf  "$API/resumes/$ID/download/cover-letter.pdf" -H "$AUTH"
```

### Builder: render and export without spending a run

```bash
curl -s -X POST $API/builder/render -H "$AUTH" -H 'content-type: application/json' -d '{
  "templateId":"modern_resume_template",
  "document":{"personal":{"fullName":"Ada Lovelace","email":"ada@example.com"},"summary":"Analyst."}
}' > preview.html

curl -s -X POST $API/builder/export -H "$AUTH" -H 'content-type: application/json' -d '{
  "templateId":"resume_template","format":"docx",
  "document":{"personal":{"fullName":"Ada Lovelace"}}
}' -o ada.docx
```

### Usage and a refused request

```bash
curl -s $API/me/usage -H "$AUTH"
# {"month":"2026-11","runs":{"used":3,"limit":20,"resetsAt":"2026-12-01T00:00:00.000Z"},...}
# When the month is used up, an upload answers:
# 429 {"error":"You have used this month's AI runs","code":"QUOTA_EXHAUSTED","details":{"limit":20,"used":20,"resetsAt":"..."},...}
```

### Refresh and sign out

```bash
curl -s -b jar.txt -c jar.txt -X POST $API/auth/refresh        # new access token, cookie rotated
curl -s -b jar.txt -X POST $API/auth/logout                    # 204
```

### As an administrator

```bash
curl -s "$API/admin/stats?from=2026-11-01&to=2026-11-10" -H "$AUTH"
curl -s $API/admin/tiers -H "$AUTH"
curl -s -X POST $API/admin/tiers -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"Pro","monthlyRuns":100,"maxResumes":50,"maxUploadMb":10}'
curl -s -X POST $API/admin/models/<model id>/test -H "$AUTH"
```

A `null` limit means unlimited. The shapes of `document` (the structured resume), the
analysis report and the builder messages are in [`packages/types/src/resume.ts`](../../packages/types/src/resume.ts).
