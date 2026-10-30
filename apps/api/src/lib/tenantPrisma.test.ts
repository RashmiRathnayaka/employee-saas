import { describe, expect, it } from "vitest";
import { getTenantPrisma } from "./tenantPrisma.js";
import { createTestCompany } from "../test/helpers.js";

describe("getTenantPrisma", () => {
  it("cannot read another company's rows", async () => {
    const companyA = await createTestCompany();
    const companyB = await createTestCompany();

    const tenantA = getTenantPrisma(companyA.id);
    const tenantB = getTenantPrisma(companyB.id);

    const dept = await tenantA.department.create({ data: { name: "Engineering", companyId: companyA.id } });

    const foundByA = await tenantA.department.findUnique({ where: { id: dept.id } });
    expect(foundByA?.id).toBe(dept.id);

    const foundByB = await tenantB.department.findUnique({ where: { id: dept.id } });
    expect(foundByB).toBeNull();

    const listByB = await tenantB.department.findMany();
    expect(listByB).toHaveLength(0);
  });

  it("always stamps creates with its own companyId, even if the input tries to set another one", async () => {
    const companyA = await createTestCompany();
    const companyB = await createTestCompany();

    const tenantA = getTenantPrisma(companyA.id);

    // Even a caller that (maliciously or by bug) sets companyB's id here
    // gets overridden back to companyA - the tenant client is authoritative.
    const dept = await tenantA.department.create({ data: { name: "Sales", companyId: companyB.id } });

    expect(dept.companyId).toBe(companyA.id);
  });
});
