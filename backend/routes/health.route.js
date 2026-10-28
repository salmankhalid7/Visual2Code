import { Router } from "express";
import { readinessCheck } from "../controllers/health.controller.js";

const router = Router();

router.get("/", readinessCheck);

export default router;