-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "allowPastDates" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written: a balance can never go negative, regardless of application
-- bugs - these are the last line of defense behind the pending/used math
-- in docs/architecture.md §3.
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_usedDays_non_negative_check" CHECK ("usedDays" >= 0);
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_pendingDays_non_negative_check" CHECK ("pendingDays" >= 0);
