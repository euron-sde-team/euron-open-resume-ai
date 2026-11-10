/** Builder rendering: no AI, no quota. Mounted at /api (GET /templates, POST /builder/render|export). */
import { Router } from "express";
import * as ctrl from "../controllers/builder.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** The 13 templates (`TemplateInfo[]`): name, description, columns, accent, atsFriendly. */
router.get("/templates", authenticate, ctrl.listTemplates);
/** Live preview: `{ document, templateId }` -> a self-contained text/html page (strict CSP). 120 per minute. */
router.post("/builder/render", authenticate, ctrl.bodyCap, rateLimit("builder-render", 120, 60), ctrl.render);
/** Download: `{ document, templateId, format: "pdf" | "docx" }` -> the file. 20 per minute. */
router.post("/builder/export", authenticate, ctrl.bodyCap, rateLimit("builder-export", 20, 60), ctrl.exportDocument);
