import { z } from "zod";
import { ScheduleDayTypeSchema } from "./attendance.js";
import { isValidShiftLength, SHIFT_LENGTH_MESSAGE, TimeOfDaySchema } from "./company.js";

const dayWeight = z.enum(["FULL", "HALF", "OFF"]);

/** All seven days: an override's week is complete, not merged with the company's. */
export const WeekScheduleSchema = z
  .object({ mon: dayWeight, tue: dayWeight, wed: dayWeight, thu: dayWeight, fri: dayWeight, sat: dayWeight, sun: dayWeight })
  .strict();
export type WeekSchedule = z.infer<typeof WeekScheduleSchema>;

const GRACE_MESSAGE = "Must be between 0 and 240";
const lateGrace = z.number({ invalid_type_error: GRACE_MESSAGE }).int(GRACE_MESSAGE).min(0, GRACE_MESSAGE).max(240, GRACE_MESSAGE);

/** PUT /employees/:id/schedule. It replaces the whole override, so a field left out goes
 * back to following the company's value. */
export const SetEmployeeScheduleRequestSchema = z
  .object({
    startTime: TimeOfDaySchema,
    endTime: TimeOfDaySchema,
    workingDays: WeekScheduleSchema.nullable().optional(),
    lateGraceMinutes: lateGrace.nullable().optional(),
  })
  .superRefine(({ startTime, endTime }, ctx) => {
    // Still runs when a time already failed, and that field has its own error.
    if (!TimeOfDaySchema.safeParse(startTime).success || !TimeOfDaySchema.safeParse(endTime).success) return;
    if (!isValidShiftLength(startTime, endTime)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: SHIFT_LENGTH_MESSAGE });
    }
  });
export type SetEmployeeScheduleRequest = z.infer<typeof SetEmployeeScheduleRequestSchema>;

export const ScheduleSourceSchema = z.enum(["COMPANY", "OVERRIDE"]);
export type ScheduleSource = z.infer<typeof ScheduleSourceSchema>;

export const EmployeeScheduleOverrideSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  /** Null: follows the company's week. */
  workingDays: WeekScheduleSchema.nullable(),
  /** Null: follows the company's grace period. */
  lateGraceMinutes: z.number().nullable(),
  updatedAt: z.string(),
});
export type EmployeeScheduleOverrideDto = z.infer<typeof EmployeeScheduleOverrideSchema>;

/** What someone normally works, with any override applied. */
export const WeeklyScheduleSchema = z.object({
  source: ScheduleSourceSchema,
  startTime: z.string(),
  endTime: z.string(),
  halfDayEndTime: z.string(),
  lateGraceMinutes: z.number(),
  workingDays: WeekScheduleSchema,
});
export type WeeklyScheduleDto = z.infer<typeof WeeklyScheduleSchema>;

/** GET /employees/:id/schedule. */
export const EmployeeScheduleResponseSchema = z.object({
  schedule: WeeklyScheduleSchema,
  override: EmployeeScheduleOverrideSchema.nullable(),
});
export type EmployeeScheduleResponse = z.infer<typeof EmployeeScheduleResponseSchema>;

export const SCHEDULE_DAYS_AHEAD = 14;

export const ScheduleDaySchema = z.object({
  date: z.string(),
  dayType: ScheduleDayTypeSchema,
  isHalfDayLeave: z.boolean(),
  /** Null on a weekly off day or a holiday. */
  scheduledStartAt: z.string().nullable(),
  scheduledEndAt: z.string().nullable(),
});
export type ScheduleDayDto = z.infer<typeof ScheduleDaySchema>;

/** GET /schedule/me: today and the 13 days after it. */
export const MyScheduleResponseSchema = z.object({
  schedule: WeeklyScheduleSchema,
  days: z.array(ScheduleDaySchema),
});
export type MyScheduleResponse = z.infer<typeof MyScheduleResponseSchema>;
