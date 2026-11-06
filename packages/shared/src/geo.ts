export type GeoPoint = { latitude: number; longitude: number };

/** Mean Earth radius. The Earth isn't a perfect sphere, but the error is well
 * under 1%, far smaller than a phone's GPS error. */
const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Straight-line distance over the Earth's surface between two
 * latitude/longitude points, in metres, using the haversine formula. The
 * server uses it to decide if a check-in is within a site's radius. The app
 * may use it to show "about 850 m away", but only the server's answer counts.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  // Rounding can push h a hair above 1 for opposite points, and asin(>1) is NaN.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
}
