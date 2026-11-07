import { z } from "zod";

export const CompanyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,12}$/, "Company code must be 3-12 uppercase letters or digits");

export const CompanyStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

export const CreateCompanyRequestSchema = z.object({
  name: z.string().trim().min(1),
  code: CompanyCodeSchema,
  adminEmail: z.string().trim().email(),
});
export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequestSchema>;

export const UpdateCompanyStatusRequestSchema = z.object({
  status: CompanyStatusSchema,
});
export type UpdateCompanyStatusRequest = z.infer<typeof UpdateCompanyStatusRequestSchema>;

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  status: CompanyStatusSchema,
  timezone: z.string(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  createdAt: z.string(),
});
export type CompanyDto = z.infer<typeof CompanySchema>;

export const UpdateCompanyProfileRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "primaryColor must be a hex colour like #4F46E5")
    .nullable()
    .optional(),
});
export type UpdateCompanyProfileRequest = z.infer<typeof UpdateCompanyProfileRequestSchema>;

export const LeaveApprovalWorkflowSchema = z.enum(["MANAGER_ONLY", "MANAGER_THEN_HR"]);

/** Modules a company can switch on or off. Leave and notifications are
 * Phase 1 core and are not gated. */
export const COMPANY_MODULES = ["attendance", "sites", "tasks"] as const;
export const CompanyModuleSchema = z.enum(COMPANY_MODULES);
export type CompanyModule = z.infer<typeof CompanyModuleSchema>;

/** Is this module on for the company? Deny by default: only a literal `true`
 * counts, so a missing key, a missing settings row, or anything malformed
 * means off. */
export function isModuleEnabled(
  settings: { enabledModules?: unknown } | null | undefined,
  module: CompanyModule,
): boolean {
  const modules = settings?.enabledModules;
  if (typeof modules !== "object" || modules === null) return false;
  return (modules as Record<string, unknown>)[module] === true;
}

/** A wall-clock time, "HH:mm" in 24-hour form. It has no date and no timezone;
 * `zonedDateTimeToUtc` turns it into an instant for a given date. */
export const TimeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, like 09:00");

/** Whole number in an inclusive range. The ranges match the CHECK constraints
 * on company_settings, so a bad value is a friendly 400, not a database error. */
function intInRange(min: number, max: number) {
  const message = `Must be between ${min} and ${max}`;
  return z.number({ invalid_type_error: message, required_error: message }).int(message).min(min, message).max(max, message);
}

/** A site's GPS radius. The company default has the same range, so a default
 * can never fail when it's copied onto a new site. */
export const SITE_RADIUS_MIN_METERS = 25;
export const SITE_RADIUS_MAX_METERS = 5000;

const SHIFT_MIN_MINUTES = 60;
const SHIFT_MAX_MINUTES = 16 * 60;

export const SHIFT_LENGTH_MESSAGE = "A shift must be between 1 and 16 hours long";

export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Is the shift from `start` to `end` ("HH:mm") 1-16 hours long? An end at or
 * before the start means the next day, as in `getShiftInstants`, so 09:00-09:00
 * is 24 hours and 22:00-06:00 is 8. */
export function isValidShiftLength(start: string, end: string): boolean {
  const length = (minutesOfDay(end) - minutesOfDay(start) + 24 * 60 - 1) % (24 * 60) + 1;
  return length >= SHIFT_MIN_MINUTES && length <= SHIFT_MAX_MINUTES;
}

export const UpdateCompanySettingsRequestSchema = z.object({
  leaveApprovalWorkflow: LeaveApprovalWorkflowSchema.optional(),
  sickLeaveProofDeadlineDays: z.number().int().min(0).optional(),
  gpsCheckinEnabledDefault: z.boolean().optional(),
  gpsRadiusMeters: intInRange(SITE_RADIUS_MIN_METERS, SITE_RADIUS_MAX_METERS).optional(),
  employeeIdPrefix: z.string().trim().min(1).max(20).optional(),
  // Strict: an unknown key is a typo, not a new module. Merged into the
  // stored value, so a key that isn't sent is left as it is.
  enabledModules: z
    .object({
      attendance: z.boolean().optional(),
      sites: z.boolean().optional(),
      tasks: z.boolean().optional(),
    })
    .strict()
    .optional(),
  workingDays: z.record(z.enum(["FULL", "HALF", "OFF"])).optional(),
  workStartTime: TimeOfDaySchema.optional(),
  workEndTime: TimeOfDaySchema.optional(),
  halfDayEndTime: TimeOfDaySchema.optional(),
  lateGraceMinutes: intInRange(0, 240).optional(),
  autoCheckoutAfterMinutes: intInRange(30, 720).optional(),
  checkinReminderEnabled: z.boolean().optional(),
  checkinReminderOffsetMinutes: intInRange(0, 120).optional(),
  proofRemindersEnabled: z.boolean().optional(),
  dailyReminderTime: TimeOfDaySchema.optional(),
  gpsMaxAccuracyMeters: intInRange(10, 1000).optional(),
  gpsRetentionDays: intInRange(30, 365).optional(),
}).superRefine((settings, ctx) => {
  // When only one of the two is sent, the API checks it against the stored
  // other one. This still runs when another field already failed, so it has
  // to tolerate a malformed time: that field has its own error.
  const { workStartTime: start, workEndTime: end } = settings;
  if (!start || !end) return;
  if (!TimeOfDaySchema.safeParse(start).success || !TimeOfDaySchema.safeParse(end).success) return;
  if (!isValidShiftLength(start, end)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["workEndTime"], message: SHIFT_LENGTH_MESSAGE });
  }
});
export type UpdateCompanySettingsRequest = z.infer<typeof UpdateCompanySettingsRequestSchema>;

/** What GET /company/settings returns. */
export const CompanySettingsSchema = z.object({
  companyId: z.string(),
  leaveApprovalWorkflow: LeaveApprovalWorkflowSchema,
  sickLeaveProofDeadlineDays: z.number(),
  gpsCheckinEnabledDefault: z.boolean(),
  gpsRadiusMeters: z.number(),
  employeeIdPrefix: z.string(),
  employeeIdNextNumber: z.number(),
  enabledModules: z.record(z.boolean()),
  workingDays: z.record(z.enum(["FULL", "HALF", "OFF"])),
  workStartTime: z.string(),
  workEndTime: z.string(),
  halfDayEndTime: z.string(),
  lateGraceMinutes: z.number(),
  autoCheckoutAfterMinutes: z.number(),
  checkinReminderEnabled: z.boolean(),
  checkinReminderOffsetMinutes: z.number(),
  proofRemindersEnabled: z.boolean(),
  dailyReminderTime: z.string(),
  gpsMaxAccuracyMeters: z.number(),
  gpsRetentionDays: z.number(),
  updatedAt: z.string(),
});
export type CompanySettingsDto = z.infer<typeof CompanySettingsSchema>;

export const CreateHolidayRequestSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  name: z.string().trim().min(1),
});
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequestSchema>;
