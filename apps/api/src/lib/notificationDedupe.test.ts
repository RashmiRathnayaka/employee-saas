import { describe, expect, it } from "vitest";
import { platformPrisma } from "./prisma.js";
import { createTestCompany, createTestUser } from "../test/helpers.js";

/** The jobs that use dedupeKey arrive in step 2.8. This pins the database
 * rule they rely on: the partial unique index on (companyId, dedupeKey). */
async function setUp() {
  const company = await createTestCompany();
  const { user } = await createTestUser({ companyId: company.id, role: "EMPLOYEE", employeeCode: "EMP-001" });
  return { company, user };
}

function notification(companyId: string, userId: string, dedupeKey?: string) {
  return { companyId, userId, type: "CHECKIN_REMINDER", title: "Reminder", body: "Body", dedupeKey };
}

describe("notifications.dedupeKey", () => {
  it("allows only one notification per key in a company", async () => {
    const { company, user } = await setUp();
    const data = notification(company.id, user.id, "CHECKIN_REMINDER:e1:2026-11-03");

    await platformPrisma.notification.create({ data });

    await expect(platformPrisma.notification.create({ data })).rejects.toThrow();
    expect(await platformPrisma.notification.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("supports ON CONFLICT DO NOTHING, which is how jobs will insert", async () => {
    const { company, user } = await setUp();
    const data = notification(company.id, user.id, "PROOF_DUE_TOMORROW:r1");

    await platformPrisma.notification.createMany({ data: [data], skipDuplicates: true });
    const second = await platformPrisma.notification.createMany({ data: [data], skipDuplicates: true });

    expect(second.count).toBe(0);
    expect(await platformPrisma.notification.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("doesn't constrain notifications without a key, like every Phase 1 one", async () => {
    const { company, user } = await setUp();

    await platformPrisma.notification.create({ data: notification(company.id, user.id) });
    await platformPrisma.notification.create({ data: notification(company.id, user.id) });

    expect(await platformPrisma.notification.count({ where: { companyId: company.id } })).toBe(2);
  });

  it("is scoped per company: the same key in two companies is fine", async () => {
    const a = await setUp();
    const b = await setUp();
    const key = "CHECKIN_REMINDER:same:2026-11-03";

    await platformPrisma.notification.create({ data: notification(a.company.id, a.user.id, key) });
    await platformPrisma.notification.create({ data: notification(b.company.id, b.user.id, key) });

    expect(await platformPrisma.notification.count({ where: { dedupeKey: key } })).toBe(2);
  });
});
