import { addDaysToIsoDate, formatDate, isoDateToUtcDate, utcDateToIsoDate } from "@employee-saas/shared";
import type { Job, JobContext } from "../../lib/jobs/runner.js";
import { getDueDailyKeys, REMINDER_CATCH_UP_MS } from "../../lib/jobs/schedule.js";
import { createNotificationsOnce, findActiveHrUserIds, leaveRangeText, type BatchNotificationInput } from "../../lib/notifications.js";

/**
 * Sick leave proof reminders: architecture-phase2 §5.4. Both run once a day at the
 * company's `dailyReminderTime`, and only while `proofRemindersEnabled` is on.
 *
 * `proofDueAt` is a calendar date stored as UTC midnight (Phase 1), so "tomorrow" and
 * "before today" are compared as dates in the company's timezone. Proof is due by the
 * end of that date: overdue starts the day after.
 *
 * Each notification has a dedupeKey, so each is sent once however often a job runs:
 * "overdue" is one message per request per HR user, never a daily nag.
 */

/** Proof that's still owed. SUBMITTED waits on HR, and ACCEPTED is done. */
const PROOF_STILL_OWED = ["MISSING", "INFO_REQUIRED", "REJECTED"] as const;
/** A request that no longer needs proof. */
const REQUEST_CLOSED = ["CANCELLED", "REJECTED", "REVOKED"] as const;

type ProofStatusOwed = (typeof PROOF_STILL_OWED)[number];

async function dueRunKeys({ company, settings, now }: JobContext): Promise<string[]> {
  if (!settings.proofRemindersEnabled) return [];
  return getDueDailyKeys({ now, timezone: company.timezone, time: settings.dailyReminderTime, catchUpMs: REMINDER_CATCH_UP_MS });
}

/** Requests whose proof is still owed, due on dates in [from, before). A request for
 * someone who has left is HR's to tidy, not something to remind anyone about. */
function findRequestsOwingProof(context: JobContext, proofDueAt: { gte?: Date; lt: Date }) {
  const { tenant, company } = context;
  return tenant.leaveRequest.findMany({
    where: {
      companyId: company.id,
      proofStatus: { in: [...PROOF_STILL_OWED] },
      status: { notIn: [...REQUEST_CLOSED] },
      proofDueAt,
      employee: { status: "ACTIVE" },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      proofDueAt: true,
      proofStatus: true,
      leaveType: { select: { name: true } },
      employee: { select: { firstName: true, lastName: true, user: { select: { id: true, status: true } } } },
    },
  });
}

/** No HR notes or document details: these will be push bodies on a lock screen in 2.9. */
function dueTomorrowBody(proofStatus: ProofStatusOwed, what: string, due: string): string {
  if (proofStatus === "INFO_REQUIRED") return `HR asked for more information about your proof for ${what}. Please send it by ${due}.`;
  if (proofStatus === "REJECTED") return `Your proof for ${what} wasn't accepted. Please upload a new one by ${due}.`;
  return `Please upload your proof for ${what} by ${due}.`;
}

function overdueBody(proofStatus: ProofStatusOwed, name: string, what: string, due: string): string {
  if (proofStatus === "INFO_REQUIRED") return `${name} hasn't sent the information you asked for about their proof for ${what}. It was due on ${due}.`;
  if (proofStatus === "REJECTED") return `${name} hasn't uploaded new proof for ${what} since it was rejected. It was due on ${due}.`;
  return `${name} hasn't uploaded proof for ${what}. It was due on ${due}.`;
}

export const proofDueTomorrowJob: Job = {
  name: "leave.proofDueTomorrow",
  dueRunKeys,
  async run(context, localDate) {
    const tomorrow = addDaysToIsoDate(localDate, 1);
    const requests = await findRequestsOwingProof(context, {
      gte: isoDateToUtcDate(tomorrow),
      lt: isoDateToUtcDate(addDaysToIsoDate(tomorrow, 1)),
    });

    const notifications = requests.flatMap((request): BatchNotificationInput[] => {
      const user = request.employee.user;
      if (!user || user.status !== "ACTIVE") return [];
      const what = `${request.leaveType.name} (${leaveRangeText(request.startDate, request.endDate)})`;
      return [
        {
          companyId: context.company.id,
          userId: user.id,
          type: "LEAVE_PROOF_DUE_SOON",
          title: "Leave proof due tomorrow",
          body: dueTomorrowBody(request.proofStatus as ProofStatusOwed, what, formatDate(tomorrow)),
          relatedEntityType: "LeaveRequest",
          relatedEntityId: request.id,
          dedupeKey: `PROOF_DUE_TOMORROW:${request.id}`,
        },
      ];
    });
    await createNotificationsOnce(context.tenant, notifications);
  },
};

export const proofOverdueJob: Job = {
  name: "leave.proofOverdue",
  dueRunKeys,
  async run(context, localDate) {
    const { tenant, company } = context;
    const requests = await findRequestsOwingProof(context, { lt: isoDateToUtcDate(localDate) });
    if (requests.length === 0) return;
    const hrUserIds = await findActiveHrUserIds(tenant, { companyId: company.id });

    const notifications = requests.flatMap((request): BatchNotificationInput[] => {
      const name = `${request.employee.firstName} ${request.employee.lastName}`;
      const what = `${request.leaveType.name} (${leaveRangeText(request.startDate, request.endDate)})`;
      const due = formatDate(utcDateToIsoDate(request.proofDueAt!));
      // An HR employee's own request: they can't review their own proof (Phase 1 rule).
      return hrUserIds
        .filter((hrUserId) => hrUserId !== request.employee.user?.id)
        .map((hrUserId) => ({
          companyId: company.id,
          userId: hrUserId,
          type: "LEAVE_PROOF_OVERDUE" as const,
          title: "Leave proof overdue",
          body: overdueBody(request.proofStatus as ProofStatusOwed, name, what, due),
          relatedEntityType: "LeaveRequest" as const,
          relatedEntityId: request.id,
          dedupeKey: `PROOF_OVERDUE:${request.id}:${hrUserId}`,
        }));
    });
    await createNotificationsOnce(tenant, notifications);
  },
};
