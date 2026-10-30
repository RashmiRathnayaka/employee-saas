import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";

export function createApp() {
  const app = express();

  // origin: true reflects the request's Origin header - required for
  // cookie-based auth (credentials: true can't be combined with the
  // wildcard "*" origin browsers would otherwise get by default).
  app.use(cors({ credentials: true, origin: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use("/api/v1", healthRouter);
  app.use("/api/v1", authRouter);

  app.use(errorHandler);

  return app;
}
