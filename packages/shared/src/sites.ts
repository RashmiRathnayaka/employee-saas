import { z } from "zod";
import { SITE_RADIUS_MAX_METERS, SITE_RADIUS_MIN_METERS } from "./company.js";

export const SiteTypeSchema = z.enum(["OFFICE", "EXTERNAL"]);
export type SiteType = z.infer<typeof SiteTypeSchema>;

function coordinate(label: string, limit: number) {
  const message = `${label} must be between -${limit} and ${limit}`;
  return z.number({ invalid_type_error: message }).min(-limit, message).max(limit, message);
}

const radiusMessage = `Must be between ${SITE_RADIUS_MIN_METERS} and ${SITE_RADIUS_MAX_METERS}`;

const siteFields = {
  name: z.string().trim().min(1, "Enter a site name").max(100),
  type: SiteTypeSchema,
  // An emptied address field means "no address".
  address: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value)),
  latitude: coordinate("Latitude", 90).nullable().optional(),
  longitude: coordinate("Longitude", 180).nullable().optional(),
  radiusMeters: z
    .number({ invalid_type_error: radiusMessage })
    .int(radiusMessage)
    .min(SITE_RADIUS_MIN_METERS, radiusMessage)
    .max(SITE_RADIUS_MAX_METERS, radiusMessage)
    .optional(),
  gpsRequired: z.boolean().optional(),
};

/** A missing radius or gpsRequired comes from the company's defaults. */
export const CreateSiteRequestSchema = z.object(siteFields);
export type CreateSiteRequest = z.infer<typeof CreateSiteRequestSchema>;

export const UpdateSiteRequestSchema = z.object(siteFields).partial();
export type UpdateSiteRequest = z.infer<typeof UpdateSiteRequestSchema>;

export const UpdateSiteStatusRequestSchema = z.object({ isActive: z.boolean() });
export type UpdateSiteStatusRequest = z.infer<typeof UpdateSiteStatusRequestSchema>;

export const SiteListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: SiteTypeSchema.optional(),
  // Not z.coerce.boolean(): that would turn the string "false" into true.
  active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type SiteListQuery = z.infer<typeof SiteListQuerySchema>;

/** What HR and Company Admin get. */
export const SiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: SiteTypeSchema,
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  radiusMeters: z.number(),
  gpsRequired: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SiteDto = z.infer<typeof SiteSchema>;

/** What employees and managers get: enough to pick a site, and no position.
 * The server does the distance maths, so the app never needs the coordinates. */
export const SiteSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: SiteTypeSchema,
  address: z.string().nullable(),
  gpsRequired: z.boolean(),
  radiusMeters: z.number(),
  hasCoordinates: z.boolean(),
});
export type SiteSummaryDto = z.infer<typeof SiteSummarySchema>;

/**
 * The rules that span several site fields, as field errors. Empty means valid.
 * The server runs this on the final values, because a partial edit or a company
 * default can complete the picture only there.
 */
export function getSiteLocationErrors(site: {
  latitude: number | null;
  longitude: number | null;
  gpsRequired: boolean;
}): Record<string, string[]> {
  const hasLatitude = site.latitude !== null;
  const hasLongitude = site.longitude !== null;
  if (hasLatitude && !hasLongitude) return { longitude: ["Enter the longitude too"] };
  if (hasLongitude && !hasLatitude) return { latitude: ["Enter the latitude too"] };
  if (site.gpsRequired && !hasLatitude) {
    return { latitude: ["A site that requires GPS needs coordinates"] };
  }
  return {};
}
