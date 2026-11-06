-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "autoCheckoutAfterMinutes" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN     "checkinReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "checkinReminderOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dailyReminderTime" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "gpsMaxAccuracyMeters" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "gpsRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "halfDayEndTime" TEXT NOT NULL DEFAULT '13:00',
ADD COLUMN     "lateGraceMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "proofRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "workEndTime" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "workStartTime" TEXT NOT NULL DEFAULT '09:00';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupeKey" TEXT;

-- Hand-written from here on (not expressible in schema.prisma); see
-- docs/phase2/database-schema-phase2.md.

-- "HH:mm" wall-clock times, plus the same ranges the shared Zod schema uses.
-- All of the defaults satisfy these, so existing rows stay valid.
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_workStartTime_format_check" CHECK ("workStartTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_workEndTime_format_check" CHECK ("workEndTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_halfDayEndTime_format_check" CHECK ("halfDayEndTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_dailyReminderTime_format_check" CHECK ("dailyReminderTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_lateGraceMinutes_range_check" CHECK ("lateGraceMinutes" BETWEEN 0 AND 240);
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_autoCheckoutAfterMinutes_range_check" CHECK ("autoCheckoutAfterMinutes" BETWEEN 30 AND 720);
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_checkinReminderOffsetMinutes_range_check" CHECK ("checkinReminderOffsetMinutes" BETWEEN 0 AND 120);
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_gpsMaxAccuracyMeters_range_check" CHECK ("gpsMaxAccuracyMeters" BETWEEN 10 AND 1000);
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_gpsRetentionDays_range_check" CHECK ("gpsRetentionDays" BETWEEN 30 AND 365);

-- A job inserts with ON CONFLICT DO NOTHING against this, so running it twice
-- (or on two servers at once) still writes one notification. Rows without a
-- key, which is every event-driven notification, are not constrained.
CREATE UNIQUE INDEX "notifications_companyId_dedupeKey_key" ON "notifications"("companyId", "dedupeKey") WHERE "dedupeKey" IS NOT NULL;
