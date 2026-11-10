# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability"):
https://github.com/euron-sde-team/euron-open-resume-ai/security/advisories/new

Please include:

- the affected component (`apps/api`, `apps/web`, `packages/api-client`,
  `infra/terraform/...`) and version or commit,
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept (against your own deployment or the local
  stack, never someone else's),
- any suggested mitigation.

What to expect:

| Stage | Target |
| ----- | ------ |
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or mitigation for critical / high issues | within 30 days |
| Coordinated public disclosure | after a fix is released, credited to you unless you prefer otherwise |

## Scope

In scope: the code in this repository and the infrastructure it provisions with its
default settings. We are most interested in:

- **Authentication and sessions.** Account takeover, access or refresh token theft or
  reuse, bypassing email verification, two-factor or the invite-only domain allowlist,
  session fixation, password reset flaws, sign-in rate limits that can be sidestepped,
  native token mode weaknesses.
- **Resume privacy.** Reading another account's resumes, analyses, cover letters, drafts,
  uploaded originals, exports or usage; an admin endpoint that reveals resume content; a
  resume id that answers differently for "exists but not yours" than for "does not exist".
- **Uploads.** Accepting types or sizes the API should refuse, magic-byte sniffing that can
  be bypassed, a crafted PDF or DOCX that exhausts memory or time (decompression bombs
  beyond the documented caps), storage keys accepted from or exposed to a client, path
  traversal through a file name.
- **Document rendering.** Script execution, network access or file access from a crafted
  resume through a template, the HTML preview (which must stay in a sandboxed iframe under a
  strict CSP), the PDF renderer (Chromium with JavaScript off and every request but `data:`
  and `about:` blocked), or the DOCX builder; `javascript:` or other unsafe links surviving
  `safeHref`; unescaped fields in a template; reading the host or the task's metadata
  endpoint through the renderer.
- **Provider keys.** Any way to make the API return, log or store a model provider key, or to
  surface raw provider error text to a user.
- **Prompt injection with a concrete impact** beyond changing the answer's text: resume or
  job description text reaching a system prompt, escaping its `<untrusted_*>` block, causing
  another account's data to be read or an outbound request, or exceeding the documented size
  caps. See [docs/architecture/threat-model.md](docs/architecture/threat-model.md).
- **Quotas and rate limits.** Spending more runs than a tier allows (including by racing
  parallel requests), refunds that can be farmed, or bypassing a rate limit by a margin larger
  than the documented overshoot.
- **Admin control plane.** Reaching `/api/admin` without the role, changing roles, tiers,
  providers or settings without permission, or tampering with the audit log.

Out of scope:

- **What admins can already do.** Admins manage accounts, quotas, providers (including
  their base URLs) and the house instructions added to every prompt. Reports that rely on
  that access are out of scope; reports that let someone gain it are very much in scope.
- **Content sent to configured providers.** Resume text and job descriptions go to the model
  provider the operator configures, by design. Choose a provider whose data terms you accept,
  or use the offline engine, which sends nothing anywhere.
- **Model behaviour.** A model writing something false or unwanted, or following an
  injected instruction to change its own answer, without one of the concrete impacts listed
  above.
- **The offline engine's writing quality.** It is deterministic and plain by design.
- **The demo seed.** `make demo` creates well-known demo accounts on purpose and refuses to
  run with `NODE_ENV=production`.
- **The stubs** (`apps/stubs`), test doubles that never run in production.
- Findings that require a compromised host, compromised AWS account, or leaked deployment
  secrets.
- Denial of service through resource exhaustion of a deployment you operate yourself, or
  spending your own provider budget.

## Hardening checklist for operators

- Deploy with the Terraform in `infra/terraform` (or match it): private subnets, TLS
  everywhere, encryption at rest with a customer-managed key, Redis with TLS and an AUTH
  token, secrets only in Secrets Manager.
- Keep `NODE_ENV=production`: the API refuses to boot with development secrets, local
  storage, the mail outbox, inline jobs, a localhost web URL or a missing `CORS_ORIGINS`.
- Put provider keys in the `<prefix>/provider-keys` secret by hand rather than in
  `terraform.tfvars`, so they stay out of Terraform state.
- Serve the web app and the API on one HTTPS host so the refresh cookie stays first-party
  and `Secure`.
- Choose a registration mode: `INVITE_ONLY` with your own email domains, or `CLOSED`, for a
  private deployment.
- Set quota tiers that match your budget, and spending limits in each provider's console.
- For sensitive resumes, leave the install on the offline engine or use a provider you have a
  data agreement with; resumes contain personal data.
- Consider the least-privilege database role for the api and worker
  ([docs/guides/operations.md](docs/guides/operations.md#least-privilege-database-role)).
- Enable CloudFront and WAF (`enable_cdn`, on in `aws-prod`) for public deployments.
- Subscribe someone to the alarm topic (`alarm_email`).
