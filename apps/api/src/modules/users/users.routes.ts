import { Router } from "express";
import {
  CreateUserRequestSchema,
  PaginationQuerySchema,
  UpdateUserRoleRequestSchema,
  UpdateUserStatusRequestSchema,
} from "@employee-saas/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { toUserDto } from "../../lib/dto.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireCompanyContext } from "../../middleware/requireCompanyContext.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { createUser, listUsers, resetUserPassword, updateUserRole, updateUserStatus } from "./users.service.js";

export const usersRouter = Router();

usersRouter.use("/users", requireAuth, requireCompanyContext);

usersRouter.get(
  "/users",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const { data, total } = await listUsers(req.auth!.companyId!, { page, pageSize });
    res.status(200).json({ data: data.map(toUserDto), page, pageSize, total });
  }),
);

usersRouter.post(
  "/users",
  requireRole("COMPANY_ADMIN"),
  validateBody(CreateUserRequestSchema),
  asyncHandler(async (req, res) => {
    const { user, temporaryPassword } = await createUser({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      email: req.body.email,
      role: req.body.role,
    });
    res.status(201).json({ user: toUserDto(user), temporaryPassword });
  }),
);

usersRouter.patch(
  "/users/:id",
  requireRole("COMPANY_ADMIN"),
  validateBody(UpdateUserRoleRequestSchema),
  asyncHandler(async (req, res) => {
    const user = await updateUserRole({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      targetUserId: req.params.id!,
      role: req.body.role,
    });
    res.status(200).json({ user: toUserDto(user) });
  }),
);

usersRouter.post(
  "/users/:id/reset-password",
  requireRole("COMPANY_ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const { temporaryPassword } = await resetUserPassword({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role as "COMPANY_ADMIN" | "HR",
      targetUserId: req.params.id!,
    });
    res.status(200).json({ temporaryPassword });
  }),
);

usersRouter.patch(
  "/users/:id/status",
  requireRole("COMPANY_ADMIN"),
  validateBody(UpdateUserStatusRequestSchema),
  asyncHandler(async (req, res) => {
    const user = await updateUserStatus({
      companyId: req.auth!.companyId!,
      actorUserId: req.auth!.userId,
      targetUserId: req.params.id!,
      status: req.body.status,
    });
    res.status(200).json({ user: toUserDto(user) });
  }),
);
