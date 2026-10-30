import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { verifyFileToken } from "../../lib/storage/fileToken.js";
import { LocalStorageService } from "../../lib/storage/localStorage.js";
import { config } from "../../config.js";

export const filesRouter = Router();

// Only meaningful for the "local" storage driver - the "s3" driver's
// getDownloadUrl() points straight at S3, bypassing this route entirely.
// Deliberately not behind requireAuth: possessing a valid (unexpired,
// correctly signed) token IS the authorization, same as an S3 presigned
// URL - the permission check already happened when the token was minted,
// in the module that called storageService.getDownloadUrl().
filesRouter.get("/files/download", asyncHandler(async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Missing token." } });
    return;
  }

  const payload = verifyFileToken(token);
  if (!payload) {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid or expired download link." } });
    return;
  }

  const storage = new LocalStorageService(config.STORAGE_LOCAL_PATH);
  const file = await storage.readForDownload(payload.key);
  if (!file) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "File not found." } });
    return;
  }

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename.replace(/"/g, "")}"`);
  file.stream.on("error", () => res.destroy());
  file.stream.pipe(res);
}));
