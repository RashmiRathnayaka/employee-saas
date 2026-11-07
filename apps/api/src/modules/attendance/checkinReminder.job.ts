import { addDaysToIsoDate, isoDateToUtcDate, todayInTimezone, utcDateToIsoDate } from "@employee-saas/shared";
import type { Job, JobContext } from "../../lib/jobs/runner.js";
import { REMINDER_CATCH_UP_MS } from "../../lib/jobs/schedule.js";
import { createNotificationsOnce, type BatchNotificationInput } from "../../lib/notifications.js";
import { getLeaveKindOnDate, resolveEffectiveSchedule, type ScheduleSettings } from "./attendance.rules.js";
import { getScheduleSettings } from "./dayClose.job.js";

/**
 * The check-in reminder: architecture-phase2 §5.4. Each employee is reminded at their
 * own shift start plus `checkinReminderOffsetMinutes` (Q18), so it can't be one run per
 * company: it runs on every tick, and the dedupeKey makes it once per employee per day.
 *
 * Skipped for: a weekly off day, a holiday, full-day approved leave, anyone who already
 * has a record or a site visit that day, no active login, and anyone who has left or
 * hasn't joined yet. Half-day leave still gets one, since which half isn't recorded (Q8).
 *
 * A reminder over 2 hours late is useless, so it isn't sent (§5.4).
 */

const ONE_MINUTE_MS = 60_000;

/** When this schedule's reminder is due, or null on a day with no shift. */
export function getReminderAt(schedule: { scheduledStartAt: Date | null }, offsetMinutes: number): Date | null {
  if (!schedule.scheduledStartAt) return null;
  return new Date(schedule.scheduledStartAt.getTime() + offsetMinutes * ONE_MINUTE_MS);
}

/** Inside the window from the reminder time to 2 hours after it. */
export function isReminderDue(reminderAt: Date | null, now: Date): boolean {
  if (!reminderAt) return false;
  const late = now.getTime() - reminderAt.getTime();
  return late >= 0 && late < REMINDER_CATCH_UP_MS;
}

type Schedules = Awaited<ReturnType<typeof getScheduleSettings>>;

async function remindForDate(context: JobContext, schedules: Schedules, workDate: string): Promise<void> {
  const { tenant, company, settings, now } = context;
  const companyId = company.id;
  const date = isoDateToUtcDate(workDate);
  const offset = settings.checkinReminderOffsetMinutes;
  const scheduleFor = (hours: ScheduleSettings, leave: "FULL" | "HALF" | null) =>
    resolveEffectiveSchedule({ workDate, timezone: company.timezone, settings: hours, isHoliday: false, leave });

  // Most ticks stop here: no set of hours in the company has its reminder due now. This
  // reads nothing beyond the overrides already loaded.
  const allHours = [schedules.companyHours, ...schedules.byEmployee.values()];
  if (!allHours.some((hours) => isReminderDue(getReminderAt(scheduleFor(hours, null), offset), now))) return;
  if (await tenant.companyHoliday.findFirst({ where: { companyId, date }, select: { id: true } })) return;

  const [employees, records, visits, leaves] = await Promise.all([
    tenant.employee.findMany({
      where: { companyId, status: "ACTIVE", joiningDate: { lte: date }, user: { is: { status: "ACTIVE" } } },
      select: { id: true, user: { select: { id: true } } },
    }),
    tenant.attendanceRecord.findMany({ where: { companyId, workDate: date }, select: { employeeId: true } }),
    tenant.siteVisit.findMany({ where: { companyId, workDate: date }, select: { employeeId: true } }),
    tenant.leaveRequest.findMany({
      where: { companyId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
      select: { employeeId: true, startDate: true, endDate: true, startHalfDay: true, endHalfDay: true },
    }),
  ]);
  const hasCheckedIn = new Set([...records, ...visits].map((row) => row.employeeId));
  const leaveByEmployee = new Map(leaves.map((leave) => [leave.employeeId, leave]));

  const dedupeKey = (employeeId: string) => `CHECKIN_REMINDER:${employeeId}:${workDate}`;
  const candidates = employees.filter((employee) => employee.user && !hasCheckedIn.has(employee.id));
  // Read what's already been sent, so a 2-hour window doesn't try every insert each tick.
  const sent = new Set(
    (
      await tenant.notification.findMany({
        where: { companyId, dedupeKey: { in: candidates.map((employee) => dedupeKey(employee.id)) } },
        select: { dedupeKey: true },
      })
    ).map((row) => row.dedupeKey),
  );

  const notifications = candidates.flatMap((employee): BatchNotificationInput[] => {
    if (sent.has(dedupeKey(employee.id))) return [];
    const leaveRow = leaveByEmployee.get(employee.id);
    const leave = leaveRow
      ? getLeaveKindOnDate({ ...leaveRow, startDate: utcDateToIsoDate(leaveRow.startDate), endDate: utcDateToIsoDate(leaveRow.endDate) }, workDate)
      : null;
    if (leave === "FULL") return [];
    const schedule = scheduleFor(schedules.byEmployee.get(employee.id) ?? schedules.companyHours, leave);
    if (!isReminderDue(getReminderAt(schedule, offset), now)) return [];

    return [
      {
        companyId,
        userId: employee.user!.id,
        type: "CHECKIN_REMINDER",
        title: "You haven't checked in yet",
        body: `Your shift started at ${schedule.startTime}. Remember to check in when you arrive.`,
        relatedEntityType: null,
        relatedEntityId: null,
        dedupeKey: dedupeKey(employee.id),
      },
    ];
  });
  await createNotificationsOnce(tenant, notifications);
}

export const checkinReminderJob: Job = {
  name: "attendance.checkinReminder",
  module: "attendance",
  async everyTick(context) {
    if (!context.settings.checkinReminderEnabled) return;
    const schedules = await getScheduleSettings(context);
    const today = todayInTimezone(context.company.timezone, context.now);
    // Yesterday too: a night shift's reminder, or a late offset, can fall after midnight.
    for (const workDate of [addDaysToIsoDate(today, -1), today]) await remindForDate(context, schedules, workDate);
  },
};
