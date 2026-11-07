import { formatDate, isoDateToUtcDate, todayInTimezone, utcDateToIsoDate } from "@employee-saas/shared";
import type { Job, JobContext } from "../../lib/jobs/runner.js";
import { sanitiseError } from "../../lib/jobs/runner.js";
import { normalizeWorkingDays } from "../../lib/leaveDays.js";
import { logger } from "../../lib/logger.js";
import { createNotificationOnce, findLoginUserIdForEmployee } from "../../lib/notifications.js";
import { applyScheduleOverride, getLeaveKindOnDate, type ScheduleSettings } from "./attendance.rules.js";
import { toScheduleOverride } from "./attendance.service.js";
import { closeRecord, linkWaitingVisits, reconcileNoCheckInRows } from "./attendanceRows.js";
import {
  getAutoCloseCutoffs,
  getCatchUpDates,
  getDateCloseState,
  getNoCheckInDay,
  getNoCheckInOutcome,
  OPEN_VISIT_MAX_MINUTES,
  wasAttendanceOnAtStart,
} from "./dayClose.rules.js";

/**
 * Day close: architecture-phase2 §5.4. Three separate passes, because they end things
 * at different times and answer to different modules:
 * 1. Forgotten records, whatever their date, as each one's close time comes.
 * 2. No-shows, per date, as each employee's close time comes.
 * 3. Forgotten visits, which may have no record to end with (`visitAutoCloseJob`).
 *
 * Each pass does nothing if run twice: conditional updates, ON CONFLICT DO NOTHING and a
 * notification dedupeKey. So two workers at once give the same result as one.
 */

const ONE_MINUTE_MS = 60_000;
/** Plenty for a tick. Any beyond this are picked up on the next one. */
const CLOSE_BATCH_SIZE = 500;

/** The company's hours, and each employee's override applied to them. */
export async function getScheduleSettings(context: JobContext) {
  const { tenant, company, settings } = context;
  const overrides = await tenant.employeeSchedule.findMany({ where: { companyId: company.id } });
  const companyHours: ScheduleSettings = { ...settings, workingDays: normalizeWorkingDays(settings.workingDays) };
  return {
    companyHours,
    byEmployee: new Map(overrides.map((row) => [row.employeeId, applyScheduleOverride(companyHours, toScheduleOverride(row))])),
  };
}

/** One failing record mustn't stop the rest. It's tried again on the next tick. */
async function forEachSafely<Row extends { id: string }>(rows: Row[], label: string, companyId: string, action: (row: Row) => Promise<void>) {
  for (const row of rows) {
    try {
      await action(row);
    } catch (err) {
      logger.error({ companyId, rowId: row.id, lastError: sanitiseError(err) }, label);
    }
  }
}

/** Pass 1. It reads the open rows through the partial index, which also holds the rows
 * with no scheduled end: those are the check-ins on a day with no schedule. */
async function closeForgottenRecords({ tenant, company, settings, now }: JobContext): Promise<void> {
  const companyId = company.id;
  const { scheduledEndAtOrBefore, noScheduleCheckInAtOrBefore } = getAutoCloseCutoffs(now, settings.autoCheckoutAfterMinutes);

  const records = await tenant.attendanceRecord.findMany({
    where: {
      companyId,
      checkInAt: { not: null },
      checkOutAt: null,
      autoClosedAt: null,
      OR: [{ scheduledEndAt: { lte: scheduledEndAtOrBefore } }, { scheduledEndAt: null, checkInAt: { lte: noScheduleCheckInAtOrBefore } }],
    },
    select: { id: true, employeeId: true, workDate: true, flags: true },
    take: CLOSE_BATCH_SIZE,
  });

  await forEachSafely(records, "Could not auto-close a record", companyId, (record) =>
    tenant.$transaction(async (tx) => {
      const closed = await closeRecord(tx, { companyId, record, now });
      if (!closed) return;

      const userId = await findLoginUserIdForEmployee(tx, { companyId, employeeId: record.employeeId });
      if (!userId) return;
      const visitsNote = closed.closedVisitSiteNames.map((name) => ` Your visit to ${name} was closed too.`).join("");
      await createNotificationOnce(tx, {
        companyId,
        userId,
        type: "ATTENDANCE_AUTO_CLOSED",
        title: "You didn't check out",
        body: `You didn't check out on ${formatDate(utcDateToIsoDate(record.workDate))}. Ask HR to correct it.${visitsNote}`,
        relatedEntityType: "AttendanceRecord",
        relatedEntityId: record.id,
        dedupeKey: `AUTO_CLOSED:${record.id}`,
      });
    }),
  );
}

/**
 * Pass 2, for one date. It writes a row for each active employee who has none and whose
 * close time has passed. It takes one query per table rather than per employee, and then
 * sends each person through the same schedule rule a check-in uses.
 */
async function markNoShows(context: JobContext, workDate: string): Promise<void> {
  const { tenant, company, settings, now } = context;
  const companyId = company.id;
  const date = isoDateToUtcDate(workDate);

  const [{ companyHours, byEmployee }, employees, existing, holiday, leaves] = await Promise.all([
    getScheduleSettings(context),
    // Not before they joined, and not once they've left (§1.5).
    tenant.employee.findMany({ where: { companyId, status: "ACTIVE", joiningDate: { lte: date } }, select: { id: true } }),
    tenant.attendanceRecord.findMany({ where: { companyId, workDate: date }, select: { employeeId: true } }),
    tenant.companyHoliday.findFirst({ where: { companyId, date }, select: { id: true } }),
    tenant.leaveRequest.findMany({
      where: { companyId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
      select: { employeeId: true, startDate: true, endDate: true, startHalfDay: true, endHalfDay: true },
    }),
  ]);
  const hasRow = new Set(existing.map((row) => row.employeeId));
  const leaveByEmployee = new Map(leaves.map((leave) => [leave.employeeId, leave]));
  const isHoliday = holiday !== null;

  const newRows = employees.flatMap((employee) => {
    if (hasRow.has(employee.id)) return [];
    const leaveRow = leaveByEmployee.get(employee.id);
    const leave = leaveRow
      ? getLeaveKindOnDate({ ...leaveRow, startDate: utcDateToIsoDate(leaveRow.startDate), endDate: utcDateToIsoDate(leaveRow.endDate) }, workDate)
      : null;
    const day = getNoCheckInDay({
      workDate,
      timezone: company.timezone,
      settings: byEmployee.get(employee.id) ?? companyHours,
      isHoliday,
      leave,
      autoCheckoutAfterMinutes: settings.autoCheckoutAfterMinutes,
    });
    if (!day || now < day.closeAt || !wasAttendanceOnAtStart(settings.attendanceEnabledAt, day.startsAt)) return [];

    return [
      {
        companyId,
        employeeId: employee.id,
        workDate: date,
        ...getNoCheckInOutcome({ isHoliday, leave }),
        scheduledStartAt: day.schedule.scheduledStartAt,
        scheduledEndAt: day.schedule.scheduledEndAt,
        source: "SYSTEM" as const,
      },
    ];
  });

  if (newRows.length > 0) {
    // A check-in or an HR correction may have just made a row: theirs stands.
    await tenant.attendanceRecord.createMany({ data: newRows, skipDuplicates: true });
    // A leave approved or holiday added since the reads above found no row to flip.
    await reconcileNoCheckInRows(tenant, { companyId, from: date, to: date });
  }
  await linkWaitingVisits(tenant, { companyId, workDate });
}

/** Each catch-up date with where it stands. The times come from each distinct set of
 * hours in the company, so it's cheap, and it doesn't load the employees. */
async function getDateStates(context: JobContext) {
  const { tenant, company, settings, now } = context;
  const dates = getCatchUpDates(todayInTimezone(company.timezone, now));
  const [{ companyHours, byEmployee }, holidays] = await Promise.all([
    getScheduleSettings(context),
    tenant.companyHoliday.findMany({
      where: { companyId: company.id, date: { gte: isoDateToUtcDate(dates[0]!), lte: isoDateToUtcDate(dates.at(-1)!) } },
      select: { date: true },
    }),
  ]);
  const holidayDates = new Set(holidays.map((holiday) => utcDateToIsoDate(holiday.date)));
  const hours = [companyHours, ...byEmployee.values()];

  return dates.map((workDate) => {
    const closeTimes = hours.flatMap((settingsForHours) => {
      const day = getNoCheckInDay({
        workDate,
        timezone: company.timezone,
        settings: settingsForHours,
        isHoliday: holidayDates.has(workDate),
        leave: null,
        autoCheckoutAfterMinutes: settings.autoCheckoutAfterMinutes,
      });
      return day ? [day.closeAt] : [];
    });
    return { workDate, state: getDateCloseState(closeTimes, now) };
  });
}

/**
 * Most ticks find nothing to do for a date, and read only overrides and holidays. While
 * some employees' close time has passed and others' hasn't, the date is scanned on every
 * tick. Once everyone's has, one worker claims it, finishes it, and nobody scans it again:
 * from then on it's the hooks that keep it right.
 */
export const dayCloseJob: Job = {
  name: "attendance.dayClose",
  module: "attendance",
  async everyTick(context) {
    await closeForgottenRecords(context);
    for (const { workDate, state } of await getDateStates(context)) {
      if (state === "PARTLY_CLOSED") await markNoShows(context, workDate);
    }
  },
  async dueRunKeys(context) {
    return (await getDateStates(context)).filter(({ state }) => state === "FINISHED").map(({ workDate }) => workDate);
  },
  run: markNoShows,
};

/**
 * Pass 3. A visit opened after the day closed, or with attendance off, has no later day
 * close to end it. So it gets its own limit, and answers to the `sites` module.
 */
export const visitAutoCloseJob: Job = {
  name: "siteVisits.autoClose",
  module: "sites",
  async everyTick({ tenant, company, now }) {
    const companyId = company.id;
    const visits = await tenant.siteVisit.findMany({
      where: { companyId, status: "OPEN", checkInAt: { lte: new Date(now.getTime() - OPEN_VISIT_MAX_MINUTES * ONE_MINUTE_MS) } },
      select: { id: true, employeeId: true, workDate: true, site: { select: { name: true } } },
      take: CLOSE_BATCH_SIZE,
    });

    await forEachSafely(visits, "Could not auto-close a site visit", companyId, (visit) =>
      tenant.$transaction(async (tx) => {
        const { count } = await tx.siteVisit.updateMany({ where: { companyId, id: visit.id, status: "OPEN" }, data: { status: "AUTO_CLOSED" } });
        if (count === 0) return;

        const userId = await findLoginUserIdForEmployee(tx, { companyId, employeeId: visit.employeeId });
        if (!userId) return;
        await createNotificationOnce(tx, {
          companyId,
          userId,
          type: "SITE_VISIT_AUTO_CLOSED",
          title: "You didn't check out of a site",
          body: `You didn't check out of ${visit.site.name} on ${formatDate(utcDateToIsoDate(visit.workDate))}. Ask HR to correct it.`,
          relatedEntityType: "SiteVisit",
          relatedEntityId: visit.id,
          dedupeKey: `AUTO_CLOSED:${visit.id}`,
        });
      }),
    );
  },
};
