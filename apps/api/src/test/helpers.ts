import crypto from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import type { Role } from "@employee-saas/shared";
import { platformPrisma } from "../lib/prisma.js";
import { DEFAULT_LEAVE_TYPES } from "../lib/defaultLeaveTypes.js";
import { hashPassword } from "../lib/passwordHashing.js";

export const DEFAULT_TEST_PASSWORD = "Passw0rd!";

export async function createTestCompany(opts: { code?: string; name?: string; status?: "ACTIVE" | "SUSPENDED" } = {}) {
  const code = opts.code ?? `T${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const company = await platformPrisma.company.create({
    data: { code, name: opts.name ?? `Test Co ${code}`, status: opts.status ?? "ACTIVE" },
  });
  await platformPrisma.companySettings.create({ data: { companyId: company.id } });
  // Matches what POST /companies actually seeds, so tests that create an
  // employee (which needs a leave type to generate a balance for) work
  // without each test having to set this up itself.
  await Promise.all(
    DEFAULT_LEAVE_TYPES.map((leaveType) => platformPrisma.leaveType.create({ data: { companyId: company.id, ...leaveType } })),
  );
  return company;
}

export async function createTestUser(params: {
  companyId: string | null;
  role: Role;
  email?: string | null;
  employeeCode?: string;
  password?: string;
  status?: "ACTIVE" | "DEACTIVATED";
  mustChangePassword?: boolean;
}) {
  const password = params.password ?? DEFAULT_TEST_PASSWORD;
  const passwordHash = await hashPassword(password);

  let employeeId: string | undefined;
  if (params.employeeCode) {
    if (!params.companyId) {
      throw new Error("createTestUser: employeeCode requires companyId");
    }
    const employee = await platformPrisma.employee.create({
      data: {
        companyId: params.companyId,
        employeeCode: params.employeeCode,
        firstName: "Test",
        lastName: "User",
        joiningDate: new Date("2024-01-01"),
      },
    });
    employeeId = employee.id;
  }

  const user = await platformPrisma.user.create({
    data: {
      companyId: params.companyId,
      employeeId,
      email: params.email ?? null,
      passwordHash,
      role: params.role,
      status: params.status ?? "ACTIVE",
      mustChangePassword: params.mustChangePassword ?? false,
    },
  });

  return { user, password, employeeId };
}

export type TestClientType = "web" | "mobile";

export async function loginAs(
  app: Express,
  params: { companyCode: string; identifier: string; password: string; clientType?: TestClientType },
) {
  const req = request(app).post("/api/v1/auth/login");
  if (params.clientType === "mobile") {
    req.set("X-Client", "mobile");
  }
  return req.send({
    companyCode: params.companyCode,
    identifier: params.identifier,
    password: params.password,
  });
}

export async function platformLoginAs(
  app: Express,
  params: { email: string; password: string; clientType?: TestClientType },
) {
  const req = request(app).post("/api/v1/auth/platform/login");
  if (params.clientType === "mobile") {
    req.set("X-Client", "mobile");
  }
  return req.send({ email: params.email, password: params.password });
}

/** Logs in (mobile client, for a plain bearer token) and returns the Authorization header value. */
export async function bearerFor(
  app: Express,
  params: { companyCode: string; identifier: string; password: string },
) {
  const res = await loginAs(app, { ...params, clientType: "mobile" });
  return `Bearer ${res.body.accessToken as string}`;
}

/** Logs in with a temporary (mustChangePassword) password, changes it, and
 * returns a bearer token for the new password - the dance every freshly
 * created login (new employee, new standalone user) has to go through
 * before it can call anything else. */
export async function activateTempPassword(
  app: Express,
  params: { companyCode: string; identifier: string; tempPassword: string; newPassword?: string },
) {
  const newPassword = params.newPassword ?? "ActivatedPassw0rd!1";
  const loginRes = await loginAs(app, {
    companyCode: params.companyCode,
    identifier: params.identifier,
    password: params.tempPassword,
    clientType: "mobile",
  });
  await request(app)
    .post("/api/v1/auth/change-password")
    .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
    .send({ currentPassword: params.tempPassword, newPassword });
  return bearerFor(app, { companyCode: params.companyCode, identifier: params.identifier, password: newPassword });
}

/** Creates a company + an ACTIVE, password-already-set user of the given
 * role, and returns a ready-to-use bearer token for them. The common setup
 * for most module tests, which mostly care about "a company with someone
 * logged in", not login mechanics. */
export async function setUpCompanyWithUser(
  app: Express,
  params: { role: Role; email?: string; employeeCode?: string } = { role: "COMPANY_ADMIN" },
) {
  const company = await createTestCompany();
  const email = params.email ?? `user-${crypto.randomBytes(3).toString("hex")}@example.test`;
  const { user, password } = await createTestUser({
    companyId: company.id,
    role: params.role,
    email,
    employeeCode: params.employeeCode,
  });
  const token = await bearerFor(app, { companyCode: company.code, identifier: email, password });
  return { company, user, token };
}

/** Creates an employee (optionally reporting to managerId) with a login,
 * activates its temp password, and returns both. Used by leave-request
 * tests, which need several distinct employee/manager logins per test. */
export async function createEmployeeWithLogin(
  app: Express,
  adminToken: string,
  companyCode: string,
  params: { firstName: string; email: string; managerId?: string; role?: "EMPLOYEE" | "MANAGER" | "HR" },
) {
  const res = await request(app)
    .post("/api/v1/employees")
    .set("Authorization", adminToken)
    .send({
      firstName: params.firstName,
      lastName: "Test",
      joiningDate: "2020-01-01",
      managerId: params.managerId,
      createLogin: true,
      loginEmail: params.email,
      loginRole: params.role ?? "EMPLOYEE",
    });
  const token = await activateTempPassword(app, {
    companyCode,
    identifier: params.email,
    tempPassword: res.body.login.temporaryPassword,
  });
  return { employee: res.body.employee, token };
}

export async function getLeaveTypeIdByCode(app: Express, token: string, code: string): Promise<string> {
  const res = await request(app).get("/api/v1/leave-types").set("Authorization", token);
  return res.body.data.find((t: { code: string }) => t.code === code).id;
}

/** Extracts a cookie's value from a supertest response's Set-Cookie headers. */
export function getCookieValue(res: request.Response, name: string): string | undefined {
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) return undefined;
  const headers: string[] = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const header of headers) {
    const match = header.match(new RegExp(`^${name}=([^;]+)`));
    if (match) return match[1];
  }
  return undefined;
}
