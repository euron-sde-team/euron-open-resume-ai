# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0]

First public release.

- Resume analysis: upload a PDF, DOCX or TXT (up to 10 MB, type checked from the file's own
  bytes) and get an ATS-style score, strengths and weaknesses, keyword gaps against an
  optional job description, an improved resume and a cover letter. Interview questions in
  four tracks (non-technical, DSA, programming, system design), a career roadmap and project
  ideas are generated on demand. A resume can be tailored to another job description.
- A chat builder that creates a resume from a conversation (or an imported file) with a live
  preview, hand editing and up to 50 saved drafts; 60 fictional sample resumes to start from.
- 13 EJS resume templates with PDF export through headless Chromium (JavaScript off, network
  blocked) and DOCX export in three layouts.
- A deterministic offline engine that runs every AI task with no model key, and provider
  adapters for OpenAI, Anthropic, Gemini and any OpenAI-compatible endpoint, managed by an
  administrator in the app. Provider keys stay in the environment.
- Accounts with email verification, password reset, optional TOTP two-factor with recovery
  codes, session management, data export and deletion with a 14-day grace period.
- Monthly AI-run quotas: tiers, per-user overrides, atomic charging with refunds, upload and
  resume-count limits. No payments.
- An admin control plane: overview charts, members, quotas, providers and models with a test
  call, deployment settings and an audit log. Admins never see resume content.
- Express 5, Kysely and Postgres with forward-only checksummed SQL migrations; a BullMQ
  worker for the AI pipeline and upkeep; Next 15 web app; S3 or local storage; SES, SMTP or
  an outbox for mail.
- Docker Compose with the Floci AWS emulator provisioned by the production Terraform modules,
  Mailpit and an OpenAI-compatible model stub; Terraform for AWS (ECS Fargate, RDS,
  ElastiCache, S3, SES, CloudFront and WAF); unit, integration, backend-matrix and Playwright
  end-to-end tests.
