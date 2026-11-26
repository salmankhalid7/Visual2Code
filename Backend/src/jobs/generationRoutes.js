import { Router } from "express";
import {
  cancelGeneration,
  createGeneration,
  readGeneration,
  readGenerationProgress,
  readGenerationResult,
} from "./generationController.js";

const router = Router();

router.post("/generation", createGeneration);
router.get("/generation/:id", readGeneration);
router.get("/generation/:id/progress", readGenerationProgress);
router.get("/generation/:id/result", readGenerationResult);
router.delete("/generation/:id", cancelGeneration);

export default router;
