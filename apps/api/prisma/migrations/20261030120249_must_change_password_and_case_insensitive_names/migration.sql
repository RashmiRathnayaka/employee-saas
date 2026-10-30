-- DropIndex
DROP INDEX "departments_companyId_name_key";

-- DropIndex
DROP INDEX "designations_companyId_name_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written: case-insensitive uniqueness per company (Prisma's schema
-- DSL can't express a functional/lower() index).
CREATE UNIQUE INDEX "departments_companyId_lower_name_key" ON "departments" ("companyId", lower("name"));
CREATE UNIQUE INDEX "designations_companyId_lower_name_key" ON "designations" ("companyId", lower("name"));
