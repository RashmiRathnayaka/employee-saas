import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { Role } from "@employee-saas/shared";
import { ApiError } from "../../lib/errors.js";
import { getTenantPrisma } from "../../lib/tenantPrisma.js";
import { writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { getStorageService } from "../../lib/storage/index.js";

type Tenant = ReturnType<typeof getTenantPrisma>;

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export function isAllowedContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType);
}

async function getOwnedLeaveRequest(tenant: Tenant, leaveRequestId: string) {
  const leaveRequest = await tenant.leaveRequest.findUnique({ where: { id: leaveRequestId } });
  if (!leaveRequest) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }
  return leaveRequest;
}

function assertCanView(params: {
  leaveRequestEmployeeId: string;
  requesterRole: Role;
  requesterEmployeeId: string | null;
}) {
  const isOwner = params.leaveRequestEmployeeId === params.requesterEmployeeId;
  const isAdminOrHr = params.requesterRole === "COMPANY_ADMIN" || params.requesterRole === "HR";
  // Managers never see medical documents, even for their own direct
  // reports - only the leave decision is their concern. See
  // docs/permissions.md "Sick leave documents".
  if (!isOwner && !isAdminOrHr) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }
}

export async function uploadDocument(params: {
  companyId: string;
  actorUserId: string;
  requesterEmployeeId: string | null;
  leaveRequestId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const leaveRequest = await getOwnedLeaveRequest(tenant, params.leaveRequestId);

  if (!params.requesterEmployeeId || leaveRequest.employeeId !== params.requesterEmployeeId) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }

  const objectKey = `company/${params.companyId}/leave-documents/${params.leaveRequestId}/${crypto.randomUUID()}`;
  const storage = getStorageService();
  await storage.put(objectKey, Readable.from(params.buffer), { contentType: params.contentType });

  return tenant.$transaction(async (tx) => {
    const document = await tx.leaveRequestDocument.create({
      data: {
        companyId: params.companyId,
        leaveRequestId: params.leaveRequestId,
        objectKey,
        filename: params.filename,
        contentType: params.contentType,
        sizeBytes: params.buffer.length,
      },
    });

    if (leaveRequest.proofStatus === "MISSING" || leaveRequest.proofStatus === "INFO_REQUIRED") {
      await tx.leaveRequest.update({ where: { id: leaveRequest.id }, data: { proofStatus: "SUBMITTED" } });
    }

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_DOCUMENT_UPLOADED",
      entityType: "LeaveRequestDocument",
      entityId: document.id,
      metadata: { leaveRequestId: params.leaveRequestId, filename: params.filename },
    });

    return document;
  });
}

export async function listDocuments(params: {
  companyId: string;
  leaveRequestId: string;
  requesterRole: Role;
  requesterEmployeeId: string | null;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const leaveRequest = await getOwnedLeaveRequest(tenant, params.leaveRequestId);
  assertCanView({
    leaveRequestEmployeeId: leaveRequest.employeeId,
    requesterRole: params.requesterRole,
    requesterEmployeeId: params.requesterEmployeeId,
  });

  return tenant.leaveRequestDocument.findMany({
    where: { leaveRequestId: params.leaveRequestId },
    orderBy: { uploadedAt: "desc" },
  });
}

export async function getDocumentDownloadUrl(params: {
  companyId: string;
  leaveRequestId: string;
  documentId: string;
  requesterRole: Role;
  requesterEmployeeId: string | null;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const leaveRequest = await getOwnedLeaveRequest(tenant, params.leaveRequestId);
  assertCanView({
    leaveRequestEmployeeId: leaveRequest.employeeId,
    requesterRole: params.requesterRole,
    requesterEmployeeId: params.requesterEmployeeId,
  });

  const document = await tenant.leaveRequestDocument.findUnique({ where: { id: params.documentId } });
  if (!document || document.leaveRequestId !== params.leaveRequestId) {
    throw new ApiError(404, "NOT_FOUND", "Document not found.");
  }

  const storage = getStorageService();
  const url = await storage.getDownloadUrl(document.objectKey, document.filename);
  return { url };
}

export async function reviewDocument(params: {
  companyId: string;
  actorUserId: string;
  leaveRequestId: string;
  documentId: string;
  status: "ACCEPTED" | "REJECTED" | "INFO_REQUIRED";
  note?: string;
}) {
  const tenant = getTenantPrisma(params.companyId);
  const leaveRequest = await tenant.leaveRequest.findUnique({
    where: { id: params.leaveRequestId },
    include: { employee: { include: { user: true } } },
  });
  if (!leaveRequest) {
    throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
  }

  const document = await tenant.leaveRequestDocument.findUnique({ where: { id: params.documentId } });
  if (!document || document.leaveRequestId !== params.leaveRequestId) {
    throw new ApiError(404, "NOT_FOUND", "Document not found.");
  }

  return tenant.$transaction(async (tx) => {
    const updatedDocument = await tx.leaveRequestDocument.update({
      where: { id: document.id },
      data: {
        status: params.status,
        reviewNote: params.note,
        reviewedById: params.actorUserId,
        reviewedAt: new Date(),
      },
    });

    await tx.leaveRequest.update({ where: { id: leaveRequest.id }, data: { proofStatus: params.status } });

    if (leaveRequest.employee.user) {
      await createNotification(tx, {
        companyId: params.companyId,
        userId: leaveRequest.employee.user.id,
        type: "LEAVE_DOCUMENT_REVIEWED",
        title: "Your sick leave document was reviewed",
        body: `Your document was marked ${params.status.toLowerCase().replace("_", " ")}.`,
        relatedEntityType: "LeaveRequestDocument",
        relatedEntityId: document.id,
      });
    }

    await writeAudit(tx, {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: "LEAVE_DOCUMENT_REVIEWED",
      entityType: "LeaveRequestDocument",
      entityId: document.id,
      metadata: { status: params.status, note: params.note },
    });

    return updatedDocument;
  });
}
