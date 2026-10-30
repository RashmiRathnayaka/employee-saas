import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const SEED_PASSWORD = "Passw0rd!";

type LeaveTypeSeed = {
  name: string;
  code: string;
  defaultAnnualDays: number;
  requiresProof: boolean;
  carryForwardAllowed: boolean;
};

const LEAVE_TYPES: LeaveTypeSeed[] = [
  { name: "Annual Leave", code: "ANNUAL", defaultAnnualDays: 14, requiresProof: false, carryForwardAllowed: true },
  { name: "Casual Leave", code: "CASUAL", defaultAnnualDays: 7, requiresProof: false, carryForwardAllowed: false },
  { name: "Sick Leave", code: "SICK", defaultAnnualDays: 7, requiresProof: true, carryForwardAllowed: false },
];

async function seedCompany(params: {
  name: string;
  code: string;
  employeeCodePrefix: string;
}) {
  const { name, code, employeeCodePrefix } = params;
  const currentYear = new Date().getUTCFullYear();

  const company = await prisma.company.upsert({
    where: { code },
    update: {},
    create: { name, code },
  });

  await prisma.companySettings.upsert({
    where: { companyId: company.id },
    update: {},
    create: { companyId: company.id },
  });

  const engineering = await prisma.department.upsert({
    where: { companyId_name: { companyId: company.id, name: "Engineering" } },
    update: {},
    create: { companyId: company.id, name: "Engineering" },
  });

  const softwareEngineer = await prisma.designation.upsert({
    where: { companyId_name: { companyId: company.id, name: "Software Engineer" } },
    update: {},
    create: { companyId: company.id, name: "Software Engineer" },
  });

  const teamLead = await prisma.designation.upsert({
    where: { companyId_name: { companyId: company.id, name: "Team Lead" } },
    update: {},
    create: { companyId: company.id, name: "Team Lead" },
  });

  const leaveTypes = await Promise.all(
    LEAVE_TYPES.map((leaveType) =>
      prisma.leaveType.upsert({
        where: { companyId_code: { companyId: company.id, code: leaveType.code } },
        update: {},
        create: { companyId: company.id, ...leaveType },
      }),
    ),
  );

  const passwordHash = await argon2.hash(SEED_PASSWORD);

  await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: `admin@${code.toLowerCase()}.test` } },
    update: {},
    create: {
      companyId: company.id,
      email: `admin@${code.toLowerCase()}.test`,
      passwordHash,
      role: "COMPANY_ADMIN",
    },
  });

  await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: `hr@${code.toLowerCase()}.test` } },
    update: {},
    create: {
      companyId: company.id,
      email: `hr@${code.toLowerCase()}.test`,
      passwordHash,
      role: "HR",
    },
  });

  const manager = await prisma.employee.upsert({
    where: { companyId_employeeCode: { companyId: company.id, employeeCode: `${employeeCodePrefix}-001` } },
    update: {},
    create: {
      companyId: company.id,
      employeeCode: `${employeeCodePrefix}-001`,
      firstName: "Morgan",
      lastName: "Lead",
      departmentId: engineering.id,
      designationId: teamLead.id,
      joiningDate: new Date("2022-01-10"),
    },
  });

  await prisma.user.upsert({
    where: { employeeId: manager.id },
    update: {},
    create: {
      companyId: company.id,
      employeeId: manager.id,
      email: `manager@${code.toLowerCase()}.test`,
      passwordHash,
      role: "MANAGER",
    },
  });

  const employeeNames = [
    { firstName: "Alex", lastName: "Employee" },
    { firstName: "Jordan", lastName: "Employee" },
    { firstName: "Taylor", lastName: "Employee" },
  ];

  const employees = [];
  for (let i = 0; i < employeeNames.length; i++) {
    const employeeCode = `${employeeCodePrefix}-${String(i + 2).padStart(3, "0")}`;
    const { firstName, lastName } = employeeNames[i]!;

    const employee = await prisma.employee.upsert({
      where: { companyId_employeeCode: { companyId: company.id, employeeCode } },
      update: {},
      create: {
        companyId: company.id,
        employeeCode,
        firstName,
        lastName,
        departmentId: engineering.id,
        designationId: softwareEngineer.id,
        managerId: manager.id,
        joiningDate: new Date("2023-03-01"),
      },
    });

    await prisma.user.upsert({
      where: { employeeId: employee.id },
      update: {},
      create: {
        companyId: company.id,
        employeeId: employee.id,
        email: `${firstName.toLowerCase()}@${code.toLowerCase()}.test`,
        passwordHash,
        role: "EMPLOYEE",
      },
    });

    employees.push(employee);
  }

  for (const employee of [manager, ...employees]) {
    for (const leaveType of leaveTypes) {
      await prisma.leaveBalance.upsert({
        where: {
          companyId_employeeId_leaveTypeId_year: {
            companyId: company.id,
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: currentYear,
          },
        },
        update: {},
        create: {
          companyId: company.id,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year: currentYear,
          allocatedDays: leaveType.defaultAnnualDays,
        },
      });
    }
  }

  await prisma.companyHoliday.upsert({
    where: { companyId_date: { companyId: company.id, date: new Date(`${currentYear}-01-01`) } },
    update: {},
    create: { companyId: company.id, date: new Date(`${currentYear}-01-01`), name: "New Year's Day" },
  });

  return { company, manager, employees };
}

async function main() {
  await seedCompany({ name: "Acme Corporation", code: "ACME", employeeCodePrefix: "ACM-EMP" });
  await seedCompany({ name: "Beta Industries", code: "BETA", employeeCodePrefix: "BETA-EMP" });

  console.log("Seed complete. All seeded users share the password:", SEED_PASSWORD);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
