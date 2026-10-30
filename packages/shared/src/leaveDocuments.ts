import { z } from "zod";

export const ReviewLeaveDocumentRequestSchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED", "INFO_REQUIRED"]),
  note: z.string().trim().max(1000).optional(),
});
export type ReviewLeaveDocumentRequest = z.infer<typeof ReviewLeaveDocumentRequestSchema>;

export const LeaveDocumentSchema = z.object({
  id: z.string(),
  leaveRequestId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["PENDING_REVIEW", "ACCEPTED", "REJECTED", "INFO_REQUIRED"]),
  reviewNote: z.string().nullable(),
  uploadedAt: z.string(),
});
export type LeaveDocumentDto = z.infer<typeof LeaveDocumentSchema>;
