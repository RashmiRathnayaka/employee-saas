import { Router, type Request } from "express";
import {
  AttendanceAdminListQuerySchema,
  AttendanceListQuerySchema,
  CheckInRequestSchema,
  CheckOutRequestSchema,
  CorrectAttendanceRequestSchema,
  CreateAttendanceRequestSchema,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { ownEmployee } from "../../lib/ownEmployee.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireModule } from "../../middleware/requireModule.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { correctRecord, createRecord, listAllRecords, listTeamRecords } from "./attendanceAdmin.service.js";
import { checkIn, checkOut, getRecord, getToday, listMyRecords } from "./attendance.service.js";

export const attendanceRouter = Router();

attendanceRouter.use("/attendance", requireAuth, requireCompanyContext, requireModule("attendance"));

const CLOCK_SKEW_WORTH_LOGGING_MS = 2 * 60_000;

/** The phone's clock is never trusted, only compared, to help diagnose reports like
 * "the app said the wrong time". This logs the difference and nothing else. */
function logClockSkew(req: Request, clientTime: string | undefined) {
  if (!clientTime) return;
  const clientClockSkewMs = new Date(clientTime).getTime() - Date.now();
  if (Math.abs(clientClockSkewMs) > CLOCK_SKEW_WORTH_LOGGING_MS) {
    req.log.info({ clientClockSkewMs }, "phone clock differs from server");
  }
}

attendanceRouter.get(
  "/attendance/me/today",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getToday(ownEmployee(req)));
  }),
);

attendanceRouter.get(
  "/attendance/me",
  asyncHandler(async (req, res) => {
    const own = ownEmployee(req);
    res.status(200).json(await listMyRecords({ ...own, query: AttendanceListQuerySchema.parse(req.query) }));
  }),
);

attendanceRouter.post(
  "/attendance/check-in",
  validateBody(CheckInRequestSchema),
  asyncHandler(async (req, res) => {
    const own = ownEmployee(req);
    logClockSkew(req, req.body.clientTime);
    const { record, created } = await checkIn({
      ...own,
      userId: req.auth!.userId,
      clientRequestId: req.body.clientRequestId,
      location: req.body.location ?? null,
    });
    res.status(created ? 201 : 200).json({ record });
  }),
);

attendanceRouter.post(
  "/attendance/check-out",
  validateBody(CheckOutRequestSchema),
  asyncHandler(async (req, res) => {
    const own = ownEmployee(req);
    logClockSkew(req, req.body.clientTime);
    res.status(200).json({ record: await checkOut({ ...own, location: req.body.location ?? null }) });
  }),
);

attendanceRouter.get(
  "/attendance/team",
  requireRole("MANAGER"),
  asyncHandler(async (req, res) => {
    const { companyId, employeeId } = ownEmployee(req);
    const query = AttendanceAdminListQuerySchema.parse(req.query);
    res.status(200).json(await listTeamRecords({ companyId, managerEmployeeId: employeeId, query }));
  }),
);

attendanceRouter.get(
  "/attendance",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const query = AttendanceAdminListQuerySchema.parse(req.query);
    res.status(200).json(await listAllRecords({ companyId: req.auth!.companyId!, query }));
  }),
);

attendanceRouter.post(
  "/attendance",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CreateAttendanceRequestSchema),
  asyncHandler(async (req, res) => {
    const record = await createRecord({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorEmployeeId: req.auth!.employeeId,
      data: req.body,
    });
    res.status(201).json({ record });
  }),
);

attendanceRouter.patch(
  "/attendance/:id/correct",
  requireRole("COMPANY_ADMIN", "HR"),
  validateBody(CorrectAttendanceRequestSchema),
  asyncHandler(async (req, res) => {
    const record = await correctRecord({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorEmployeeId: req.auth!.employeeId,
      recordId: req.params.id!,
      data: req.body,
    });
    res.status(200).json({ record });
  }),
);

// After /attendance/me and /team, which this pattern would otherwise swallow.
attendanceRouter.get(
  "/attendance/:id",
  asyncHandler(async (req, res) => {
    const result = await getRecord({
      companyId: req.auth!.companyId!,
      role: req.auth!.role,
      callerEmployeeId: req.auth!.employeeId,
      recordId: req.params.id!,
    });
    res.status(200).json(result);
  }),
);
