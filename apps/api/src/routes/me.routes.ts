/** /api/me: your usage and preferences. */
import { Router } from "express";
import * as ctrl from "../controllers/me.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();
/** This month's AI runs against your allowance (`Usage`). Resets on the first of the month, UTC. */
router.get("/usage", authenticate, ctrl.usage);
/** Your `Preferences`. */
router.get("/preferences", authenticate, ctrl.getPreferences);
/** Change preferences: any of `{ defaultTemplate }`. */
router.patch("/preferences", authenticate, ctrl.updatePreferences);
