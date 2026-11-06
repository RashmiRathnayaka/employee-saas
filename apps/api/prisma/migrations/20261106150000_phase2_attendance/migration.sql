-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ON_LEAVE', 'HOLIDAY', 'ABSENT', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MOBILE', 'SITE_VISIT', 'HR', 'SYSTEM');

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "workedMinutes" INTEGER,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "checkInSiteId" TEXT,
    "checkInLat" DECIMAL(9,6),
    "checkInLng" DECIMAL(9,6),
    "checkInAccuracyM" INTEGER,
    "checkInDistanceM" INTEGER,
    "checkInWithinRadius" BOOLEAN,
    "checkInMocked" BOOLEAN,
    "checkOutLat" DECIMAL(9,6),
    "checkOutLng" DECIMAL(9,6),
    "checkOutAccuracyM" INTEGER,
    "checkOutDistanceM" INTEGER,
    "checkOutWithinRadius" BOOLEAN,
    "checkOutMocked" BOOLEAN,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "AttendanceSource" NOT NULL,
    "autoClosedAt" TIMESTAMP(3),
    "isCorrected" BOOLEAN NOT NULL DEFAULT false,
    "checkInClientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_records_companyId_workDate_status_idx" ON "attendance_records"("companyId", "workDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_companyId_employeeId_workDate_key" ON "attendance_records"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_companyId_employeeId_checkInClientReques_key" ON "attendance_records"("companyId", "employeeId", "checkInClientRequestId");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_checkInSiteId_fkey" FOREIGN KEY ("checkInSiteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here on (not expressible in schema.prisma); see
-- docs/phase2/database-schema-phase2.md.

-- For the auto-close job (step 2.7): records still open.
CREATE INDEX "attendance_records_open_scheduledEndAt_idx" ON "attendance_records" ("companyId", "scheduledEndAt") WHERE "checkOutAt" IS NULL AND "checkInAt" IS NOT NULL;
-- For the GPS purge job (step 2.8): records that still hold a position.
CREATE INDEX "attendance_records_gps_checkInAt_idx" ON "attendance_records" ("companyId", "checkInAt") WHERE "checkInLat" IS NOT NULL;

ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_checkOut_after_checkIn_check" CHECK ("checkOutAt" IS NULL OR "checkOutAt" > "checkInAt");
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_checkOut_needs_checkIn_check" CHECK ("checkOutAt" IS NULL OR "checkInAt" IS NOT NULL);
-- A status that means "they were here" must have a check-in.
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_status_needs_checkIn_check" CHECK ("status" NOT IN ('PRESENT', 'LATE', 'INCOMPLETE') OR "checkInAt" IS NOT NULL);
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_workedMinutes_check" CHECK ("workedMinutes" IS NULL OR "workedMinutes" >= 0);
