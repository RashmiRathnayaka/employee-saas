-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "attendanceEnabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "jobName" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_status_startedAt_idx" ON "job_runs"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written from here on (not expressible in schema.prisma); see
-- docs/phase2/database-schema-phase2.md.

-- Whoever's insert succeeds owns the run (architecture-phase2 §5.3). NULLS NOT DISTINCT makes
-- two platform-wide rows (companyId NULL) collide too, where Postgres would otherwise allow both.
CREATE UNIQUE INDEX "job_runs_jobName_runKey_companyId_key" ON "job_runs" ("jobName", "runKey", "companyId") NULLS NOT DISTINCT;

-- Companies already using attendance start counting from today. Without this, the first day
-- close would mark everyone ABSENT for the last two days, before the worker ever existed.
-- UTC midnight is before any shift starts today in Colombo.
UPDATE "company_settings"
SET "attendanceEnabledAt" = date_trunc('day', now() AT TIME ZONE 'UTC')
WHERE "enabledModules"->>'attendance' = 'true';
