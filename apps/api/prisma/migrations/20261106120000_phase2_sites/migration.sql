-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('OFFICE', 'EXTERNAL');

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SiteType" NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "radiusMeters" INTEGER NOT NULL,
    "gpsRequired" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sites_companyId_isActive_type_idx" ON "sites"("companyId", "isActive", "type");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here on (not expressible in schema.prisma); see
-- docs/phase2/database-schema-phase2.md.

-- Case-insensitive name uniqueness per company, like departments.
CREATE UNIQUE INDEX "sites_companyId_lower_name_key" ON "sites" ("companyId", lower("name"));

ALTER TABLE "sites" ADD CONSTRAINT "sites_radiusMeters_range_check" CHECK ("radiusMeters" BETWEEN 25 AND 5000);
ALTER TABLE "sites" ADD CONSTRAINT "sites_latitude_range_check" CHECK ("latitude" BETWEEN -90 AND 90);
ALTER TABLE "sites" ADD CONSTRAINT "sites_longitude_range_check" CHECK ("longitude" BETWEEN -180 AND 180);
-- Half a position is useless: both or neither.
ALTER TABLE "sites" ADD CONSTRAINT "sites_coordinates_together_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
-- A GPS-required site must have somewhere to measure from.
ALTER TABLE "sites" ADD CONSTRAINT "sites_gps_required_coordinates_check" CHECK (NOT "gpsRequired" OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL));

-- The default for a new site's radius has the same range as the radius itself.
-- Every existing row has to satisfy this for the migration to apply.
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_gpsRadiusMeters_range_check" CHECK ("gpsRadiusMeters" BETWEEN 25 AND 5000);
