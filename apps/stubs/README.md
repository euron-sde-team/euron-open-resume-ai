# @open-resume/stubs

A deterministic stand-in for an OpenAI-compatible model endpoint, for development, CI and the
integration tests. One dependency-free Node script (`node:http`), state in memory, port 5199.

The API runs its real provider adapter against it; only the base URL differs from production.
The starter catalogue adds the "Local stub" provider (kind `STUB`, which needs no key) only
through `demo:seed` and only outside production.

```bash
PORT=5199 node apps/stubs/server.mjs        # or: pnpm --filter @open-resume/stubs start
pnpm --filter @open-resume/stubs test        # wire-format and decision tests
```

Point the API at it with `STUBS_URL=http://localhost:5199`; providers of kind `STUB` call
`$STUBS_URL/v1`. An `OPENAI_COMPATIBLE` provider can use the same URL as its base URL.

## Endpoints

| Route | Answers |
| --- | --- |
| `POST /v1/chat/completions` | OpenAI chat, streaming (SSE) or not, with `usage` |
| `GET /v1/models` | `stub-text` |
| `GET /__/requests` | recorded requests, newest first (bodies, and whether a key was sent) |
| `POST /__/reset` | clears the record |
| `GET /up` | health check |

With `response_format: { type: "json_object" }` the answer is the JSON object
`{ "stub": true, "echo": "<first 80 characters of the last user message>" }`; otherwise it is
`Stub reply: <echo>`. The resume tasks extend `answerFor` in `server.mjs` with their
deterministic outputs.

Words in the last user message steer it:

| Words | What the model does |
| --- | --- |
| `slow` | streams 40 sentences, 60 ms apart (cancel and resume tests) |
| `fail` | answers 500 |
| `ratelimit` | answers 429 |
| `context overflow` | answers 400 `context_length_exceeded` |

Keys are never checked: any `Authorization` header is accepted and recorded only as "present"
or "absent".
