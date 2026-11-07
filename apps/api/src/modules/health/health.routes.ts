import { Router } from "express";
import type { HealthResponse } from "@employee-saas/shared";
import { getWorkerStatus } from "../../lib/jobs/runner.js";
import { platformPrisma } from "../../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  await platformPrisma.$queryRaw`SELECT 1`;

  const now = new Date();
  const body: HealthResponse = {
    status: "ok",
    db: "ok",
    timestamp: now.toISOString(),
    // A worker being down doesn't fail the check: the API itself is fine, and a load
    // balancer shouldn't take it out of service for that.
    worker: await getWorkerStatus(now),
  };
  res.status(200).json(body);
});
