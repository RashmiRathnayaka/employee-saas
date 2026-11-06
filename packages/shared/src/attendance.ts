import { z } from "zod";
import { daysBetweenIsoDates, isIsoDate } from "./dates.js";

export const AttendanceStatusSchema = z.enum(["PRESENT", "LATE", "ON_LEAVE", "HOLIDAY", "ABSENT", "INCOMPLETE"]);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const AttendanceSourceSchema = z.enum(["MOBILE", "SITE_VISIT", "HR", "SYSTEM"]);
export type AttendanceSource = z.infer<typeof AttendanceSourceSchema>;

export const ATTENDANCE_FLAGS = [
  "LOW_ACCURACY",
  "OUTSIDE_RADIUS_AT_CHECKOUT",
  "MOCK_LOCATION_AT_CHECKOUT",
  "LOCATION_UNAVAILABLE_AT_CHECKOUT",
  "STALE_LOCATION",
  "NO_OFFICE_SITE",
  "NON_WORKING_DAY",
  "ON_APPROVED_LEAVE",
  "HALF_DAY_LEAVE",
  "AUTO_CLOSED",
  "LONG_SHIFT",
] as const;
export const AttendanceFlagSchema = z.enum(ATTENDANCE_FLAGS);
export type AttendanceFlag = z.infer<typeof AttendanceFlagSchema>;

/** What the app should offer next. See architecture-phase2 §1.3. */
export const AttendanceNextActionSchema = z.enum(["CHECK_IN", "CHECK_OUT", "DONE", "DAY_CLOSED"]);
export type AttendanceNextAction = z.infer<typeof AttendanceNextActionSchema>;

/** What kind of day the schedule says this is. */
export const ScheduleDayTypeSchema = z.enum(["WORKING", "HALF", "OFF", "HOLIDAY", "ON_LEAVE"]);
export type ScheduleDayType = z.infer<typeof ScheduleDayTypeSchema>;

/** Larger than any real fix, and small enough to always fit the whole-metre column. */
const MAX_ACCURACY_METERS = 1_000_000;

/**
 * One fix, read when the employee taps (architecture-phase2 §3.1). The phone never
 * sends a distance or a "within radius" answer: the server works those out.
 */
export const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** The phone's radius of uncertainty, in metres. */
  accuracy: z.number().min(0).max(MAX_ACCURACY_METERS),
  mocked: z.boolean(),
  capturedAt: z.string().datetime(),
});
export type LocationDto = z.infer<typeof LocationSchema>;

/**
 * Check-in and check-out bodies. The phone never sends a work date, a status or a
 * time the server would trust: `clientTime` is only logged, to diagnose a wrong
 * phone clock. Unknown fields are dropped. A `location` is only kept when the site
 * requires GPS (§3.1): the server discards it otherwise.
 */
const clientTime = z.string().datetime().optional();

export const CheckInRequestSchema = z.object({
  clientRequestId: z.string().uuid(),
  location: LocationSchema.optional(),
  clientTime,
});
export type CheckInRequest = z.infer<typeof CheckInRequestSchema>;

export const CheckOutRequestSchema = z.object({ location: LocationSchema.optional(), clientTime });
export type CheckOutRequest = z.infer<typeof CheckOutRequestSchema>;

/** A date in a list's query string. */
export const isoDateParam = z
  .string()
  .trim()
  .refine(isIsoDate, "Use a date like 2026-11-03");

export const ATTENDANCE_MAX_RANGE_DAYS = 93;

/** The `from`/`to` rule shared by the attendance and site visit lists. */
export function refineDateRange({ from, to }: { from?: string | undefined; to?: string | undefined }, ctx: z.RefinementCtx): void {
  // Runs even if a date above failed, and daysBetween throws on a malformed one.
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) return;
  const days = daysBetweenIsoDates(from, to);
  if (days < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "The end date is before the start date" });
  } else if (days > ATTENDANCE_MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: `Choose a range of ${ATTENDANCE_MAX_RANGE_DAYS} days or less`,
    });
  }
}

export const AttendanceListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    from: isoDateParam.optional(),
    to: isoDateParam.optional(),
  })
  .superRefine(refineDateRange);
export type AttendanceListQuery = z.infer<typeof AttendanceListQuerySchema>;

/** What everyone allowed to see a record gets, managers included. It has "were
 * they at the site?", and no position. */
export const AttendanceRecordSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  workDate: z.string(),
  status: AttendanceStatusSchema,
  scheduledStartAt: z.string().nullable(),
  scheduledEndAt: z.string().nullable(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  workedMinutes: z.number().nullable(),
  lateMinutes: z.number(),
  earlyLeaveMinutes: z.number(),
  checkInSiteId: z.string().nullable(),
  checkInAccuracyM: z.number().nullable(),
  checkInDistanceM: z.number().nullable(),
  checkInWithinRadius: z.boolean().nullable(),
  checkInMocked: z.boolean().nullable(),
  checkOutAccuracyM: z.number().nullable(),
  checkOutDistanceM: z.number().nullable(),
  checkOutWithinRadius: z.boolean().nullable(),
  checkOutMocked: z.boolean().nullable(),
  flags: z.array(AttendanceFlagSchema),
  source: AttendanceSourceSchema,
  autoClosedAt: z.string().nullable(),
  isCorrected: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AttendanceRecordDto = z.infer<typeof AttendanceRecordSchema>;

/** The same record with exact positions: for its owner, HR and Company Admin. */
export const AttendanceRecordWithCoordinatesSchema = AttendanceRecordSchema.extend({
  checkInLat: z.number().nullable(),
  checkInLng: z.number().nullable(),
  checkOutLat: z.number().nullable(),
  checkOutLng: z.number().nullable(),
});
export type AttendanceRecordWithCoordinatesDto = z.infer<typeof AttendanceRecordWithCoordinatesSchema>;

export const EffectiveScheduleSchema = z.object({
  dayType: ScheduleDayTypeSchema,
  /** True on a day with half a day's approved leave: lateness isn't judged. */
  isHalfDayLeave: z.boolean(),
  /** Null on a weekly off day or a holiday, which have no schedule. */
  scheduledStartAt: z.string().nullable(),
  scheduledEndAt: z.string().nullable(),
  lateGraceMinutes: z.number(),
});
export type EffectiveScheduleDto = z.infer<typeof EffectiveScheduleSchema>;

/** GET /attendance/me/today: everything the Home card needs. */
export const AttendanceTodaySchema = z.object({
  workDate: z.string(),
  schedule: EffectiveScheduleSchema,
  record: AttendanceRecordWithCoordinatesSchema.nullable(),
  nextAction: AttendanceNextActionSchema,
  /** Whether the next tap should read the phone's location (§3.1). */
  gpsRequired: z.boolean(),
  /** The office that tap is checked against. Null if there's none, or several: the
   * server can only pick the nearest once it has the location. No coordinates. */
  officeSite: z.object({ id: z.string(), name: z.string(), radiusMeters: z.number() }).nullable(),
  /** The site visit a day check-out would also close (§1.6). Null with `sites` off. */
  openVisit: z.object({ id: z.string(), siteName: z.string(), checkInAt: z.string() }).nullable(),
});
export type AttendanceTodayDto = z.infer<typeof AttendanceTodaySchema>;
