## What and why

<!-- One paragraph: the problem, and how this change solves it. Link the issue. -->

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `make test-integration` (if API, database, queue, AI provider, resume pipeline or mail code changed)
- [ ] `make test-matrix` (if storage or mail backends changed)
- [ ] `make e2e` (if a user flow or the infrastructure changed)
- [ ] `make tf-validate tf-lint tf-security` (if Terraform changed)

## Checklist

- [ ] Docs updated (`docs/`, the configuration reference) for any behavior or config change
- [ ] `pnpm openapi` re-run if a route changed
- [ ] New migration instead of editing an applied one
- [ ] Access stays scoped: resumes, uploads, analyses and exports are visible only to their owner (a stranger gets 404, never 403; admins see only what they are meant to), covered by a test
- [ ] Provider keys never reach the database, a log line or an API response
- [ ] Untrusted input stays bounded: uploads are size-limited and type-sniffed, the PDF renderer blocks network requests, resume and job description text is fenced as data in prompts, and the API never fetches a user-supplied URL
- [ ] No secrets, account ids, real emails or hostnames (`make sanitize` is clean)
- [ ] Security-relevant change? Described the threat and mitigation above
