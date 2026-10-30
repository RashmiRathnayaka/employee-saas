import { Router } from "express";
import type { HealthResponse } from "@employee-saas/shared";
import { prisma } from "../../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;

  const body: HealthResponse = {
    status: "ok",
    db: "ok",
    timestamp: new Date().toISOString(),
  };
  res.status(200).json(body);
});
