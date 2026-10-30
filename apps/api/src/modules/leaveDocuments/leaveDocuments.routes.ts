import { Router } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import type { LeaveRequestDocument } from "@prisma/client";
import { ReviewLeaveDocumentRequestSchema, type LeaveDocumentDto } from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import {
  getDocumentDownloadUrl,
  isAllowedContentType,
  listDocuments,
  reviewDocument,
  uploadDocument,
} from "./leaveDocuments.service.js";

export const leaveDocumentsRouter = Router();

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_BYTES } });

function toLeaveDocumentDto(document: LeaveRequestDocument): LeaveDocumentDto {
  return {
    id: document.id,
    leaveRequestId: document.leaveRequestId,
    filename: document.filename,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    reviewNote: document.reviewNote,
    uploadedAt: document.uploadedAt.toISOString(),
  };
}

leaveDocumentsRouter.use("/leave-requests/:id/documents", requireAuth, requireCompanyContext);

leaveDocumentsRouter.post(
  "/leave-requests/:id/documents",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new ApiError(400, "VALIDATION_ERROR", "A file is required.");
    }

    if (!isAllowedContentType(file.mimetype)) {
      throw new ApiError(400, "UNSUPPORTED_FILE_TYPE", "Only jpg, png, and pdf files are accepted.");
    }

    // The declared content type is never trusted on its own - a renamed
    // .exe claiming to be a PDF is caught here, by sniffing the actual
    // bytes. See docs/architecture.md §6.
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !isAllowedContentType(detected.mime)) {
      throw new ApiError(400, "UNSUPPORTED_FILE_TYPE", "The file's content does not match an accepted type.");
    }

    const document = await uploadDocument({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      requesterEmployeeId: req.auth!.employeeId,
      leaveRequestId: req.params.id!,
      filename: file.originalname,
      contentType: detected.mime,
      buffer: file.buffer,
    });
    res.status(201).json({ document: toLeaveDocumentDto(document) });
  }),
);

leaveDocumentsRouter.get(
  "/leave-requests/:id/documents",
  asyncHandler(async (req, res) => {
    const documents = await listDocuments({
      companyId: req.auth!.companyId!,
      leaveRequestId: req.params.id!,
      requesterRole: req.auth!.role,
      requesterEmployeeId: req.auth!.employeeId,
    });
    res.status(200).json({ data: documents.map(toLeaveDocumentDto) });
  }),
);

leaveDocumentsRouter.get(
  "/leave-requests/:id/documents/:docId/download",
  asyncHandler(async (req, res) => {
    const { url } = await getDocumentDownloadUrl({
      companyId: req.auth!.companyId!,
      leaveRequestId: req.params.id!,
      documentId: req.params.docId!,
      requesterRole: req.auth!.role,
      requesterEmployeeId: req.auth!.employeeId,
    });
    res.status(200).json({ url });
  }),
);

leaveDocumentsRouter.patch(
  "/leave-requests/:id/documents/:docId/review",
  requireRole("HR"),
  validateBody(ReviewLeaveDocumentRequestSchema),
  asyncHandler(async (req, res) => {
    const document = await reviewDocument({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      leaveRequestId: req.params.id!,
      documentId: req.params.docId!,
      status: req.body.status,
      note: req.body.note,
    });
    res.status(200).json({ document: toLeaveDocumentDto(document) });
  }),
);
