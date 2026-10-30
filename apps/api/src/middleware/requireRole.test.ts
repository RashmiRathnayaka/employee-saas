import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requireRole } from "./requireRole.js";
import type { RequestAuth } from "../lib/authTypes.js";

function fakeRequest(auth?: RequestAuth): Request {
  return { auth } as unknown as Request;
}

describe("requireRole", () => {
  it("calls next() with no error when the role matches", () => {
    const req = fakeRequest({ userId: "u1", companyId: "c1", role: "HR", employeeId: null });
    const next = vi.fn();

    requireRole("HR", "COMPANY_ADMIN")(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("blocks a mismatched role with 403", () => {
    const req = fakeRequest({ userId: "u1", companyId: "c1", role: "EMPLOYEE", employeeId: "e1" });
    const next = vi.fn();

    requireRole("HR", "COMPANY_ADMIN")(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const errArg = next.mock.calls[0]?.[0];
    expect(errArg).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("rejects when there is no req.auth at all", () => {
    const req = fakeRequest(undefined);
    const next = vi.fn();

    requireRole("HR")(req, {} as Response, next);

    const errArg = next.mock.calls[0]?.[0];
    expect(errArg).toMatchObject({ statusCode: 401, code: "UNAUTHENTICATED" });
  });
});
