import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createEmployeeWithLogin, getLeaveTypeIdByCode, setUpCompanyWithUser } from "../../test/helpers.js";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const PDF_BYTES = Buffer.from("%PDF-1.4\n%fake pdf content for testing purposes only\n");
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const EXE_BYTES = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(32)]); // "MZ" - real Windows EXE magic

async function submitSickLeave(app: ReturnType<typeof createApp>, adminToken: string, employeeToken: string) {
  const sickTypeId = await getLeaveTypeIdByCode(app, adminToken, "SICK");
  const res = await request(app)
    .post("/api/v1/leave-requests")
    .set("Authorization", employeeToken)
    .send({ leaveTypeId: sickTypeId, startDate: "2026-03-02", endDate: "2026-03-02" });
  return res.body.leaveRequest;
}

describe("POST /api/v1/leave-requests/:id/documents", () => {
  it("accepts a valid PDF and moves proofStatus MISSING -> SUBMITTED", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);
    expect(leaveRequest.proofStatus).toBe("MISSING");

    const res = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", PDF_BYTES, { filename: "proof.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.document.status).toBe("PENDING_REVIEW");

    const afterRes = await request(app).get(`/api/v1/leave-requests/${leaveRequest.id}`).set("Authorization", employeeToken);
    expect(afterRes.body.leaveRequest.proofStatus).toBe("SUBMITTED");
  });

  it("accepts a valid PNG", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);

    const res = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", PNG_BYTES, { filename: "proof.png", contentType: "image/png" });
    expect(res.status).toBe(201);
  });

  it("rejects a declared type outside the allow-list", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);

    const res = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", PDF_BYTES, { filename: "proof.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects a renamed .exe even when it declares an accepted content type", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);

    const res = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", EXE_BYTES, { filename: "proof.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects a file over 5 MB", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);

    const bigFile = Buffer.concat([PDF_BYTES, Buffer.alloc(6 * 1024 * 1024)]);
    const res = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", bigFile, { filename: "huge.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("cross-tenant: company B's employee gets 404 uploading to company A's request", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);

    const { token: otherEmployeeToken } = await setUpCompanyWithUser(app, { role: "EMPLOYEE", employeeCode: "EMP-999" });

    const res = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", otherEmployeeToken)
      .attach("file", PDF_BYTES, { filename: "proof.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(404);
  });
});

describe("document review and download visibility", () => {
  it("HR review sets both the document status and the request's proofStatus", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: hrToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "HR",
      email: "hr@example.test",
      role: "HR",
    });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);
    const uploadRes = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", PDF_BYTES, { filename: "proof.pdf", contentType: "application/pdf" });

    const reviewRes = await request(app)
      .patch(`/api/v1/leave-requests/${leaveRequest.id}/documents/${uploadRes.body.document.id}/review`)
      .set("Authorization", hrToken)
      .send({ status: "ACCEPTED", note: "Looks good" });
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.document.status).toBe("ACCEPTED");

    const requestAfter = await request(app)
      .get(`/api/v1/leave-requests/${leaveRequest.id}`)
      .set("Authorization", employeeToken);
    expect(requestAfter.body.leaveRequest.proofStatus).toBe("ACCEPTED");
  });

  it("EMPLOYEE (not HR) cannot review a document", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);
    const uploadRes = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", PDF_BYTES, { filename: "proof.pdf", contentType: "application/pdf" });

    const res = await request(app)
      .patch(`/api/v1/leave-requests/${leaveRequest.id}/documents/${uploadRes.body.document.id}/review`)
      .set("Authorization", employeeToken)
      .send({ status: "ACCEPTED" });
    expect(res.status).toBe(403);
  });

  it("a manager gets 404 trying to download a direct report's document", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { employee: manager, token: managerToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Manager",
      email: "manager@example.test",
      role: "MANAGER",
    });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Report",
      email: "report@example.test",
      managerId: manager.id,
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);
    const uploadRes = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", PDF_BYTES, { filename: "proof.pdf", contentType: "application/pdf" });

    const listRes = await request(app)
      .get(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", managerToken);
    expect(listRes.status).toBe(404);

    const downloadRes = await request(app)
      .get(`/api/v1/leave-requests/${leaveRequest.id}/documents/${uploadRes.body.document.id}/download`)
      .set("Authorization", managerToken);
    expect(downloadRes.status).toBe(404);
  });

  it("the owner can get a working download URL, and a tampered/expired token is rejected", async () => {
    const app = createApp();
    const { token: adminToken, company } = await setUpCompanyWithUser(app, { role: "COMPANY_ADMIN" });
    const { token: employeeToken } = await createEmployeeWithLogin(app, adminToken, company.code, {
      firstName: "Solo",
      email: "solo@example.test",
    });
    const leaveRequest = await submitSickLeave(app, adminToken, employeeToken);
    const uploadRes = await request(app)
      .post(`/api/v1/leave-requests/${leaveRequest.id}/documents`)
      .set("Authorization", employeeToken)
      .attach("file", PDF_BYTES, { filename: "proof.pdf", contentType: "application/pdf" });

    const downloadRes = await request(app)
      .get(`/api/v1/leave-requests/${leaveRequest.id}/documents/${uploadRes.body.document.id}/download`)
      .set("Authorization", employeeToken);
    expect(downloadRes.status).toBe(200);
    const url: string = downloadRes.body.url;
    expect(url).toMatch(/^\/api\/v1\/files\/download\?token=/);

    const validFetch = await request(app).get(url);
    expect(validFetch.status).toBe(200);
    expect(validFetch.headers["content-disposition"]).toContain("proof.pdf");

    const [path, token] = url.split("?token=");
    const tamperedToken = `${token!.slice(0, -4)}zzzz`;
    const tamperedFetch = await request(app).get(`${path}?token=${tamperedToken}`);
    expect(tamperedFetch.status).toBe(401);

    vi.setSystemTime(new Date("2026-01-15T00:06:00.000Z")); // 6 min later - token TTL is 5 min
    const expiredFetch = await request(app).get(url);
    expect(expiredFetch.status).toBe(401);
    vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
  });
});
