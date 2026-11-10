/** /api/drafts: builder drafts (up to 50 per user). */
import { Router } from "express";
import * as ctrl from "../controllers/draft.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

router.use(authenticate);

/** Your drafts, most recently edited first (`Page<ResumeDraftSummary>`). */
router.get("/", ctrl.list);
/** Save a draft: `{ name?, templateId?, document }`. 201 `ResumeDraft`. 409 DRAFT_LIMIT at 50. */
router.post("/", rateLimit("draft-write", 120, 60), ctrl.create);
/** One draft with its document (`ResumeDraft`). */
router.get("/:id", ctrl.detail);
/** Edit a draft: any of `{ name, templateId, document }`. Returns `ResumeDraft`. */
router.put("/:id", rateLimit("draft-write", 120, 60), ctrl.update);
/** Delete a draft. 204. */
router.delete("/:id", ctrl.remove);
