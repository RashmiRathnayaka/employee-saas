-- CreateTable
CREATE TABLE "employee_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "workingDays" JSONB,
    "lateGraceMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "attendanceRecordId" TEXT,
    "siteVisitId" TEXT,
    "correctedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_schedules_companyId_employeeId_key" ON "employee_schedules"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "attendance_corrections_companyId_attendanceRecordId_idx" ON "attendance_corrections"("companyId", "attendanceRecordId");

-- CreateIndex
CREATE INDEX "attendance_corrections_companyId_siteVisitId_idx" ON "attendance_corrections"("companyId", "siteVisitId");

-- AddForeignKey
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "site_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here on (not expressible in schema.prisma); see
-- docs/phase2/database-schema-phase2.md.

ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_startTime_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_endTime_check" CHECK ("endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_lateGraceMinutes_check" CHECK ("lateGraceMinutes" IS NULL OR "lateGraceMinutes" BETWEEN 0 AND 240);

-- A correction belongs to a record or to a visit, never both or neither.
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_one_target_check" CHECK (("attendanceRecordId" IS NULL) <> ("siteVisitId" IS NULL));
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_reason_check" CHECK (length(trim("reason")) >= 5);
