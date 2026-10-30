import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./modules/health/health.routes.js";

export function createApp() {
  const app = express();

  app.use(cors({ credentials: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use("/api/v1", healthRouter);

  app.use(errorHandler);

  return app;
}
