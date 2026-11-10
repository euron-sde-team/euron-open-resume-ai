-- Euron Open Resume AI: the resume domain (resumes, per-component pipeline state, builder drafts).
--
-- Every row is owned by one user and every query filters on user_id; someone else's id is
-- a 404. Parsed documents and AI results are jsonb in the shapes of packages/types/src/resume.ts.
-- The uploaded file itself lives in object storage under resumes/<user>/<resume>/original.<ext>;
-- only its key is stored here. Queue jobs carry ids, never any of this content.

CREATE TYPE resume_source AS ENUM ('upload', 'builder');
-- Derived from the components (services/resume/components.ts deriveStatus) and stored for listing.
CREATE TYPE resume_status AS ENUM ('queued', 'processing', 'analyzed', 'error');
CREATE TYPE resume_component_kind AS ENUM (
  'analysis',
  'rewrite',
  'interview_non_technical',
  'interview_dsa',
  'interview_programming',
  'interview_system_design',
  'roadmap',
  'projects'
);
CREATE TYPE resume_component_status AS ENUM ('pending', 'processing', 'done', 'failed', 'skipped');

CREATE TABLE resumes (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  source        resume_source NOT NULL,
  status        resume_status NOT NULL DEFAULT 'queued',
  file_name     text,
  file_key      text,                         -- storage key of the original upload
  file_mime     text,
  file_size     integer CHECK (file_size >= 0),
  jd            text CHECK (length(jd) <= 20000),
  company       text CHECK (length(company) <= 120),
  is_tailored   boolean NOT NULL DEFAULT false,
  parent_id     text REFERENCES resumes (id) ON DELETE SET NULL,
  template_id   text NOT NULL DEFAULT 'modern_resume_template',
  original      jsonb,                        -- ResumeDocument parsed from the upload (or the builder document)
  improved      jsonb,                        -- ResumeDocument rewritten by the AI
  analysis      jsonb,                        -- ResumeAnalysis { before, after }
  cover_letter  jsonb,                        -- CoverLetter
  score         integer CHECK (score BETWEEN 0 AND 100),
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  updated_at    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX resumes_user_updated_idx ON resumes (user_id, updated_at DESC, id DESC);
CREATE INDEX resumes_parent_idx ON resumes (parent_id) WHERE parent_id IS NOT NULL;

-- One row per AI unit of work on a resume. `status` is the user-visible state; 'processing'
-- covers both "queued" and "running", and claimed_at tells them apart (null until a worker
-- picks it up). `attempts` counts worker attempts of the current request; `charged` is the
-- number of runs taken for it (given back if it finally fails). `data` holds the result of the
-- interview, roadmap and projects components.
CREATE TABLE resume_components (
  resume_id   text NOT NULL REFERENCES resumes (id) ON DELETE CASCADE,
  kind        resume_component_kind NOT NULL,
  status      resume_component_status NOT NULL DEFAULT 'pending',
  error       text,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  charged     integer NOT NULL DEFAULT 0 CHECK (charged >= 0),
  claimed_at  timestamptz(3),
  data        jsonb,
  updated_at  timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (resume_id, kind)
);

-- Builder drafts: a ResumeDocument being edited. The API caps a user at 50.
CREATE TABLE resume_drafts (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  template_id  text NOT NULL DEFAULT 'modern_resume_template',
  document     jsonb NOT NULL,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  updated_at   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX resume_drafts_user_updated_idx ON resume_drafts (user_id, updated_at DESC, id DESC);
