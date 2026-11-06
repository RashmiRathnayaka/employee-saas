-- CreateEnum
CREATE TYPE "SiteVisitStatus" AS ENUM ('OPEN', 'CLOSED', 'AUTO_CLOSED');

-- CreateTable
CREATE TABLE "site_visits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "attendanceRecordId" TEXT,
    "workDate" DATE NOT NULL,
    "status" "SiteVisitStatus" NOT NULL DEFAULT 'OPEN',
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
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
    "note" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "isCorrected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_visits_companyId_siteId_checkInAt_idx" ON "site_visits"("companyId", "siteId", "checkInAt");

-- CreateIndex
CREATE INDEX "site_visits_companyId_employeeId_checkInAt_idx" ON "site_visits"("companyId", "employeeId", "checkInAt");

-- CreateIndex
CREATE INDEX "site_visits_companyId_workDate_idx" ON "site_visits"("companyId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "site_visits_companyId_employeeId_clientRequestId_key" ON "site_visits"("companyId", "employeeId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here on (not expressible in schema.prisma); see
-- docs/phase2/database-schema-phase2.md.

-- At most one open visit per employee, even with two simultaneous check-ins.
CREATE UNIQUE INDEX "site_visits_one_open_per_employee_key" ON "site_visits" ("companyId", "employeeId") WHERE "status" = 'OPEN';
-- For the GPS purge job (step 2.8): visits that still hold a position.
CREATE INDEX "site_visits_gps_checkInAt_idx" ON "site_visits" ("companyId", "checkInAt") WHERE "checkInLat" IS NOT NULL;

ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_checkOut_after_checkIn_check" CHECK ("checkOutAt" IS NULL OR "checkOutAt" > "checkInAt");
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_durationMinutes_check" CHECK ("durationMinutes" IS NULL OR "durationMinutes" >= 0);
-- An open visit has no check-out, and a closed one has. AUTO_CLOSED has none until HR
-- corrects it, so it isn't covered.
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_open_has_no_checkOut_check" CHECK ("status" <> 'OPEN' OR "checkOutAt" IS NULL);
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_closed_has_checkOut_check" CHECK ("status" <> 'CLOSED' OR "checkOutAt" IS NOT NULL);
