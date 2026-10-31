import { Router } from "express";
import type { LeaveApproval, LeaveRequest } from "@prisma/client";
import {
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveRequestListQuerySchema,
  PreviewLeaveDaysRequestSchema,
  RevokeLeaveRequestSchema,
  type LeaveApprovalDto,
  type LeaveRequestDto,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import {
  getApprovalHistory,
  getLeaveRequestById,
  listAllLeaveRequests,
  listOwnLeaveRequests,
  listTeamLeaveRequests,
  previewLeaveDays,
  submitLeaveRequest,
} from "./leaveRequests.service.js";
import { cancelLeaveRequest, decideLeaveRequest, revokeLeaveRequest } from "./leaveDecisions.service.js";

export const leaveRequestsRouter = Router();

export function toLeaveRequestDto(request: LeaveRequest): LeaveRequestDto {
  return {
    id: request.id,
    companyId: request.companyId,
    employeeId: request.employeeId,
    leaveTypeId: request.leaveTypeId,
    startDate: request.startDate.toISOString().slice(0, 10),
    endDate: request.endDate.toISOString().slice(0, 10),
    startHalfDay: request.startHalfDay,
    endHalfDay: request.endHalfDay,
    totalDays: request.totalDays.toNumber(),
    reason: request.reason,
    status: request.status,
    proofStatus: request.proofStatus,
    proofDueAt: request.proofDueAt?.toISOString() ?? null,
    revokedAt: request.revokedAt?.toISOString() ?? null,
    revokeNote: request.revokeNote,
    createdAt: request.createdAt.toISOString(),
  };
}

leaveRequestsRouter.use("/leave-requests", requireAuth, requireCompanyContext);

leaveRequestsRouter.post(
  "/leave-requests",
  validateBody(CreateLeaveRequestSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth!.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "This action requires an employee profile.");
    }
    const leaveRequest = await submitLeaveRequest({
      companyId: req.auth!.companyId!,
      employeeId: req.auth!.employeeId,
      actorUserId: req.auth!.userId,
      ...req.body,
    });
    res.status(201).json({ leaveRequest: toLeaveRequestDto(leaveRequest) });
  }),
);

leaveRequestsRouter.post(
  "/leave-requests/preview",
  validateBody(PreviewLeaveDaysRequestSchema),
  asyncHandler(async (req, res) => {
    const totalDays = await previewLeaveDays({ companyId: req.auth!.companyId!, ...req.body });
    res.status(200).json({ totalDays });
  }),
);

// Must come before "/leave-requests/:id" - see docs/architecture.md §3.
leaveRequestsRouter.get(
  "/leave-requests/me",
  asyncHandler(async (req, res) => {
    if (!req.auth!.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "This action requires an employee profile.");
    }
    const query = LeaveRequestListQuerySchema.parse(req.query);
    const { data, total } = await listOwnLeaveRequests({
      companyId: req.auth!.companyId!,
      employeeId: req.auth!.employeeId,
      ...query,
    });
    res.status(200).json({ data: data.map(toLeaveRequestDto), page: query.page, pageSize: query.pageSize, total });
  }),
);

leaveRequestsRouter.get(
  "/leave-requests/team",
  requireRole("MANAGER"),
  asyncHandler(async (req, res) => {
    if (!req.auth!.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "This action requires an employee profile.");
    }
    const query = LeaveRequestListQuerySchema.parse(req.query);
    const { data, total } = await listTeamLeaveRequests({
      companyId: req.auth!.companyId!,
      managerEmployeeId: req.auth!.employeeId,
      ...query,
    });
    res.status(200).json({ data: data.map(toLeaveRequestDto), page: query.page, pageSize: query.pageSize, total });
  }),
);

leaveRequestsRouter.get(
  "/leave-requests",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const query = LeaveRequestListQuerySchema.parse(req.query);
    const { data, total } = await listAllLeaveRequests({ companyId: req.auth!.companyId!, ...query });
    res.status(200).json({ data: data.map(toLeaveRequestDto), page: query.page, pageSize: query.pageSize, total });
  }),
);

type ApprovalWithApprover = LeaveApproval & { approver: { id: string; email: string | null; role: LeaveApprovalDto["approver"]["role"] } };
function toLeaveApprovalDto(approval: ApprovalWithApprover): LeaveApprovalDto {
  return {
    id: approval.id,
    step: approval.step,
    decision: approval.decision,
    note: approval.note,
    decidedAt: approval.decidedAt.toISOString(),
    approver: { id: approval.approver.id, email: approval.approver.email, role: approval.approver.role },
  };
}

leaveRequestsRouter.get(
  "/leave-requests/:id",
  asyncHandler(async (req, res) => {
    const leaveRequest = await getLeaveRequestById({
      companyId: req.auth!.companyId!,
      leaveRequestId: req.params.id!,
      requesterRole: req.auth!.role,
      requesterEmployeeId: req.auth!.employeeId,
    });
    const approvals = await getApprovalHistory({ companyId: req.auth!.companyId!, leaveRequestId: req.params.id! });
    res.status(200).json({
      leaveRequest: toLeaveRequestDto(leaveRequest),
      approvals: approvals.map(toLeaveApprovalDto),
    });
  }),
);

leaveRequestsRouter.patch(
  "/leave-requests/:id/cancel",
  asyncHandler(async (req, res) => {
    if (!req.auth!.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "This action requires an employee profile.");
    }
    const leaveRequest = await cancelLeaveRequest({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      employeeId: req.auth!.employeeId,
      leaveRequestId: req.params.id!,
    });
    res.status(200).json({ leaveRequest: toLeaveRequestDto(leaveRequest) });
  }),
);

leaveRequestsRouter.patch(
  "/leave-requests/:id/approve",
  requireRole("MANAGER", "HR"),
  validateBody(DecideLeaveRequestSchema),
  asyncHandler(async (req, res) => {
    const leaveRequest = await decideLeaveRequest({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorEmployeeId: req.auth!.employeeId,
      leaveRequestId: req.params.id!,
      decision: "APPROVED",
      note: req.body.note,
    });
    res.status(200).json({ leaveRequest: toLeaveRequestDto(leaveRequest) });
  }),
);

leaveRequestsRouter.patch(
  "/leave-requests/:id/reject",
  requireRole("MANAGER", "HR"),
  validateBody(DecideLeaveRequestSchema),
  asyncHandler(async (req, res) => {
    const leaveRequest = await decideLeaveRequest({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorEmployeeId: req.auth!.employeeId,
      leaveRequestId: req.params.id!,
      decision: "REJECTED",
      note: req.body.note,
    });
    res.status(200).json({ leaveRequest: toLeaveRequestDto(leaveRequest) });
  }),
);

leaveRequestsRouter.patch(
  "/leave-requests/:id/revoke",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(RevokeLeaveRequestSchema),
  asyncHandler(async (req, res) => {
    const leaveRequest = await revokeLeaveRequest({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      leaveRequestId: req.params.id!,
      note: req.body.note,
    });
    res.status(200).json({ leaveRequest: toLeaveRequestDto(leaveRequest) });
  }),
);
