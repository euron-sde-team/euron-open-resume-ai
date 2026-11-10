# Documentation

Euron Open Resume AI is a self-hosted, single-tenant Resume AI. Members sign up, upload a
resume (PDF, DOCX or TXT) or build one in a chat, and get an ATS-style analysis and score, an
improved resume and cover letter (optionally tailored to a job description), interview
questions in four tracks, a career roadmap and project ideas, then pick one of 13 templates
and export PDF or DOCX. Administrators manage members, monthly AI-run quota tiers, model
providers and the audit trail. There are no payments. With no model key the AI runs on a
deterministic offline engine. These pages describe the system as it is in this repository;
every path, endpoint and variable named here is in the code.

## Start here

| If you want to | Read |
| --- | --- |
| Run it on your machine in a few minutes | [guides/quickstart-local.md](guides/quickstart-local.md) |
| Click through every screen as a member and as an admin | [guides/walkthrough.md](guides/walkthrough.md) |
| Understand the design | [architecture/HLD.md](architecture/HLD.md) |
| Use a real model instead of the offline engine | [guides/connect-real-providers.md](guides/connect-real-providers.md) |
| Put it on AWS | [guides/deploy-aws.md](guides/deploy-aws.md) |
| Call the API | [guides/api.md](guides/api.md) |
| Know the security posture | [architecture/security.md](architecture/security.md) |

## Architecture

| Page | Covers |
| --- | --- |
| [HLD.md](architecture/HLD.md) | The system view: web, API, worker, Postgres, Redis, storage, mail, providers; a request end to end |
| [LLD.md](architecture/LLD.md) | The API's layers (routes, controllers, services, repositories, presenters), middleware, auth, jobs, the web app |
| [data-model.md](architecture/data-model.md) | Tables and how they relate |
| [resume-pipeline.md](architecture/resume-pipeline.md) | Upload to report: extraction, components, claims, retries, refunds |
| [ai-engine.md](architecture/ai-engine.md) | Provider adapters, structured output, the offline engine, prompt safety |
| [rendering-and-templates.md](architecture/rendering-and-templates.md) | The mapper, EJS templates, HTML preview, PDF through Chromium, DOCX |
| [quotas.md](architecture/quotas.md) | Tiers, overrides, atomic charging, refunds, rate limits |
| [security.md](architecture/security.md) | Controls and the known gaps |
| [threat-model.md](architecture/threat-model.md) | Threats by area and residual risks |

## Decisions

[architecture/adr/README.md](architecture/adr/README.md) lists the architecture decision
records. A change that alters a documented decision needs a new or updated record.

## Guides

| Guide | For |
| --- | --- |
| [quickstart-local.md](guides/quickstart-local.md) | `make up`, `make demo`, URLs, demo accounts, running the apps outside Docker |
| [walkthrough.md](guides/walkthrough.md) | A tour of every screen and flow, member then admin |
| [configuration.md](guides/configuration.md) | Every environment variable, the production guard, deployment settings, secrets |
| [connect-real-providers.md](guides/connect-real-providers.md) | OpenAI, Anthropic, Gemini and compatible providers; the offline engine; S3, SES, SMTP |
| [add-a-template.md](guides/add-a-template.md) | A new resume template end to end |
| [deploy-aws.md](guides/deploy-aws.md) | Terraform, images, migrations, the first admin, DNS, costs, Chromium in Fargate |
| [operations.md](guides/operations.md) | Jobs and queues, quotas, backups, migrations, secret rotation, scaling, upgrades |
| [testing.md](guides/testing.md) | Unit, integration, backend matrix, end to end, the sanitizer, CI |
| [troubleshooting.md](guides/troubleshooting.md) | Symptom, cause, fix |
| [api.md](guides/api.md) | The HTTP API by area, errors, curl examples |

## Reference

| File | What it is |
| --- | --- |
| [api/openapi.yaml](api/openapi.yaml) | The generated OpenAPI 3.1 reference; `pnpm openapi` regenerates it, `pnpm openapi --check` verifies it |
| [diagrams/](diagrams) | Mermaid sources for the architecture diagrams |

The repository root also has [CONTRIBUTING.md](../CONTRIBUTING.md),
[SECURITY.md](../SECURITY.md), [CHANGELOG.md](../CHANGELOG.md) and
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).
