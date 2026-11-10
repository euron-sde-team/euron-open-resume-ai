# @open-resume/samples

A library of about 60 sample resumes across 30 roles and three seniority levels (fresher, mid, senior), used by the sample picker and by tests and template previews.

## The data is synthetic

Every person, employer, school, product, email, phone number and link is invented. Nothing refers to a real company, university or individual.

- Emails use `name@example.com` only.
- Phones are in the reserved fictional range (`+1 555 01xx xx` or `555-01xx`).
- Links point at `https://example.com/...` paths only.
- Metrics in bullet points are randomly generated and are not tied to any real entity.

## Regenerate

The output is deterministic (seeded PRNG, no dependencies beyond Node):

```bash
node packages/samples/scripts/generate.mjs   # writes data/samples.json
node packages/samples/scripts/validate.mjs   # plain Node checks, no test runner needed
```

Role content lives in `scripts/roles-a.mjs` and `scripts/roles-b.mjs`. Change the seed in `scripts/generate.mjs` to get a different but equally synthetic set. Do not edit `data/samples.json` by hand.

## Use

```ts
import { samples, findSample, listSamples } from '@open-resume/samples';

listSamples({ level: 'senior', q: 'data' });
findSample('registered-nurse-mid');
```

Each entry is a canonical resume document (`personal`, `links`, `summary`, `experience`, `education`, `skills`, `projects`, `certifications`, `languages`, `achievements`) plus manifest fields: `id`, `role`, `field`, `level`, `tags`, `suggestedTemplate`.

Special cases for template stress tests: `full-stack-developer-senior` (six roles, dense) and `frontend-developer-fresher` (projects only, no work experience).
