/** /api/files/local: the stand-in for presigned GET URLs when STORAGE=local (development only). */
import { Router } from "express";
import * as ctrl from "../controllers/storage.controller";

export const router = Router();
/** Read a stored file through a signed, expiring local link. 403 FILE_LINK_INVALID; 404 when the file is gone. */
router.get("/local/:token", ctrl.localGet);
