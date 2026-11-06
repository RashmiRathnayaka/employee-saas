import { z } from "zod";
import { LocationSchema, refineDateRange, isoDateParam } from "./attendance.js";

export const SiteVisitStatusSchema = z.enum(["OPEN", "CLOSED", "AUTO_CLOSED"]);
export type SiteVisitStatus = z.infer<typeof SiteVisitStatusSchema>;

/** The GPS flags attendance records use (architecture-phase2 §3.2), plus two that say
 * how the visit relates to its attendance day (§1.6). */
export const SITE_VISIT_FLAGS = [
  "LOW_ACCURACY",
  "OUTSIDE_RADIUS_AT_CHECKOUT",
  "MOCK_LOCATION_AT_CHECKOUT",
  "LOCATION_UNAVAILABLE_AT_CHECKOUT",
  "STALE_LOCATION",
  /** Started after that day had closed. The attendance record isn't changed. */
  "AFTER_HOURS",
  /** Started on a day already marked ABSENT. The row isn't changed: HR resolves it. */
  "ON_ABSENT_DAY",
] as const;
export const SiteVisitFlagSchema = z.enum(SITE_VISIT_FLAGS);
export type SiteVisitFlag = z.infer<typeof SiteVisitFlagSchema>;

const SITE_VISIT_NOTE_MAX = 500;
const note = z.string().trim().min(1).max(SITE_VISIT_NOTE_MAX).optional();

/** As with office attendance, the phone never sends a work date, a time or a distance.
 * A `location` is only kept when the site requires GPS (§3.1). */
export const SiteCheckInRequestSchema = z.object({
  siteId: z.string().uuid(),
  clientRequestId: z.string().uuid(),
  location: LocationSchema.optional(),
  note,
});
export type SiteCheckInRequest = z.infer<typeof SiteCheckInRequestSchema>;

export const SiteCheckOutRequestSchema = z.object({ location: LocationSchema.optional(), note });
export type SiteCheckOutRequest = z.infer<typeof SiteCheckOutRequestSchema>;

/** GET /site-visits/me. */
export const MySiteVisitsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    from: isoDateParam.optional(),
    to: isoDateParam.optional(),
  })
  .superRefine(refineDateRange);
export type MySiteVisitsQuery = z.infer<typeof MySiteVisitsQuerySchema>;

/** GET /site-visits and /site-visits/team. */
export const SiteVisitListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    from: isoDateParam.optional(),
    to: isoDateParam.optional(),
    employeeId: z.string().uuid().optional(),
    siteId: z.string().uuid().optional(),
    // Not z.coerce.boolean(): that would turn the string "false" into true.
    openOnly: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .superRefine(refineDateRange);
export type SiteVisitListQuery = z.infer<typeof SiteVisitListQuerySchema>;

/** What everyone allowed to see a visit gets, managers included. It has "were they at
 * the site?", and no position. */
export const SiteVisitSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  employeeCode: z.string(),
  siteId: z.string(),
  siteName: z.string(),
  attendanceRecordId: z.string().nullable(),
  workDate: z.string(),
  status: SiteVisitStatusSchema,
  checkInAt: z.string(),
  checkOutAt: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  checkInAccuracyM: z.number().nullable(),
  checkInDistanceM: z.number().nullable(),
  checkInWithinRadius: z.boolean().nullable(),
  checkInMocked: z.boolean().nullable(),
  checkOutAccuracyM: z.number().nullable(),
  checkOutDistanceM: z.number().nullable(),
  checkOutWithinRadius: z.boolean().nullable(),
  checkOutMocked: z.boolean().nullable(),
  flags: z.array(SiteVisitFlagSchema),
  note: z.string().nullable(),
  isCorrected: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SiteVisitDto = z.infer<typeof SiteVisitSchema>;

/** The same visit with exact positions: for its owner, HR and Company Admin. */
export const SiteVisitWithCoordinatesSchema = SiteVisitSchema.extend({
  checkInLat: z.number().nullable(),
  checkInLng: z.number().nullable(),
  checkOutLat: z.number().nullable(),
  checkOutLng: z.number().nullable(),
});
export type SiteVisitWithCoordinatesDto = z.infer<typeof SiteVisitWithCoordinatesSchema>;

/** GET /site-visits/me/open. `gpsRequired` tells the app whether checking out of it
 * should read the phone's location. */
export const OpenSiteVisitResponseSchema = z.object({
  visit: SiteVisitWithCoordinatesSchema.nullable(),
  gpsRequired: z.boolean(),
});
export type OpenSiteVisitResponse = z.infer<typeof OpenSiteVisitResponseSchema>;
