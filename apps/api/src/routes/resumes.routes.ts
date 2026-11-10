/** /api/resumes: upload or build a resume, read its analysis, run more AI work, export. */
import { Router } from "express";
import * as ctrl from "../controllers/resume.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

router.use(authenticate);

/**
 * Upload a resume: multipart `file` (pdf, docx, txt or md; the type is checked from the bytes; at most your tier's
 * upload size and 10 MB) plus optional `jd`, `company`, `templateId`, `title`. Charges one run, stores the file and starts the
 * analysis. 202 `ResumeSummary`. 413 FILE_TOO_LARGE, 415 UNSUPPORTED_FILE, 422 NO_TEXT, 429 QUOTA_EXHAUSTED, 409 RESUME_LIMIT.
 */
router.post("/", rateLimit("resume-create", 20, 3600), ctrl.upload);
/** Analyse a resume built in the builder: `{ document, templateId?, jd?, company?, title? }`. Charges one run. 202 `ResumeSummary`. */
router.post("/from-document", rateLimit("resume-create", 20, 3600), ctrl.fromDocument);
/** Your resumes, most recently updated first (`Page<ResumeSummary>`). */
router.get("/", ctrl.list);
/** One resume with its analysis, improved document, cover letter and generated components (`ResumeDetail`). */
router.get("/:id", ctrl.detail);
/** A cheap status check for polling (`ResumeStatusView`). */
router.get("/:id/status", ctrl.status);
/** Re-run what failed: `{ component? }` (default: every failed step). Charges one run per job. 202 `ResumeSummary`. */
router.post("/:id/retry", rateLimit("resume-ai", 30, 3600), ctrl.retry);
/** Tailor a copy of this resume to a job: `{ jd, company? }`. Creates a new resume with `parentId` set. Charges one run. 202 `ResumeSummary`. */
router.post("/:id/tailor", rateLimit("resume-create", 20, 3600), ctrl.tailor);
/** Generate one more component on demand: kind is interview_non_technical, interview_dsa, interview_programming, interview_system_design, roadmap or projects. One run. 202 `ResumeSummary`. */
router.post("/:id/components/:kind", rateLimit("resume-ai", 30, 3600), ctrl.component);
/** Delete the resume, its components and its stored file. 204. */
router.delete("/:id", ctrl.remove);
/** Download `original`, `resume.pdf`, `resume.docx`, `cover-letter.pdf` or `cover-letter.docx` (attachment, no-store). `?template=` re-renders the resume with another template. */
router.get("/:id/download/:what", rateLimit("resume-download", 40, 60), ctrl.download);
/** The improved resume as a self-contained HTML page for a sandboxed iframe (`?template=`). Strict CSP, no scripts. */
router.get("/:id/render", rateLimit("resume-render", 120, 60), ctrl.render);
