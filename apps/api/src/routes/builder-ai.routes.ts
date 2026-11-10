/** /api/builder (AI part): the chat builder and resume import. Render, export and drafts live in builder.routes. */
import { Router } from "express";
import * as ctrl from "../controllers/builder-ai.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
/** Merge a conversation into the document: `{ messages, document? }` -> `{ assistant, document, nextPrompts }`. Costs one run. */
router.post("/chat", authenticate, rateLimit("builder-chat", 20, 60), ctrl.chat);
/** multipart `file` (pdf, docx, txt, md up to 10 MB) -> `{ assistant, document }`. Costs one run. */
router.post("/import", authenticate, rateLimit("builder-import", 6, 60), ctrl.importResume);
