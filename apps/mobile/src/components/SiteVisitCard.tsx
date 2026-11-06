import { Linking, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { formatDuration, formatTime, type SiteVisitWithCoordinatesDto } from "@employee-saas/shared";
import { ApiClientError } from "../lib/apiClient";
import { getAttendanceErrorMessage, isLocationRequiredError } from "../lib/attendance";
import { useElapsedMinutes, useOpenSiteVisit, useSiteVisitActions } from "../lib/siteVisits";
import { useCompanyTimezone } from "../lib/theme";
import { strings } from "../strings";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useLocationGate } from "./useLocationGate";

function OpenVisitBanner({ visit, timezone }: { visit: SiteVisitWithCoordinatesDto; timezone: string }) {
  const minutes = useElapsedMinutes(visit.checkInAt);
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Text style={styles.bannerSite}>{strings.siteVisits.atSite(visit.siteName)}</Text>
      <Text style={styles.bannerTime}>
        {strings.siteVisits.since(formatTime(visit.checkInAt, timezone))} · {formatDuration(minutes)}
      </Text>
    </View>
  );
}

/** Home's site visit card: check in at a site, or the visit that's open now. */
export function SiteVisitCard() {
  const timezone = useCompanyTimezone();
  const openQuery = useOpenSiteVisit(true);
  const { checkOut } = useSiteVisitActions();
  const visit = openQuery.data?.visit ?? null;
  const gate = useLocationGate<{ visitId: string; gpsRequired: boolean }>((tap) => checkOut.mutate(tap));
  const pending = gate.preparing || checkOut.isPending;

  // The module was switched off after this screen loaded.
  if (openQuery.error instanceof ApiClientError && openQuery.error.code === "MODULE_DISABLED") {
    return null;
  }

  return (
    <Card>
      <Text style={styles.title}>{strings.siteVisits.title}</Text>

      {openQuery.isPending ? <Text style={styles.muted}>{strings.common.loading}</Text> : null}
      {openQuery.isError ? <Text style={styles.muted}>{getAttendanceErrorMessage(openQuery.error)}</Text> : null}

      {visit ? (
        <>
          <OpenVisitBanner visit={visit} timezone={timezone} />
          <Button
            title={strings.siteVisits.checkOut}
            loading={pending}
            onPress={() => {
              const gpsRequired = openQuery.data!.gpsRequired;
              void gate.start({ visitId: visit.id, gpsRequired }, gpsRequired);
            }}
          />
        </>
      ) : null}
      {openQuery.isSuccess && !visit ? (
        <Button title={strings.siteVisits.checkIn} onPress={() => router.push("/site-picker")} />
      ) : null}

      <View style={styles.history}>
        <Button title={strings.siteVisits.myVisits} variant="secondary" onPress={() => router.push("/my-visits")} />
      </View>

      {checkOut.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {getAttendanceErrorMessage(checkOut.error)}
        </Text>
      ) : null}
      {isLocationRequiredError(checkOut.error) ? (
        <View style={styles.history}>
          <Button title={strings.location.openSettings} variant="secondary" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}

      {gate.disclosure}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 8 },
  muted: { fontSize: 14, color: "#6B7280", marginBottom: 8 },
  banner: { backgroundColor: "#ECFDF5", borderRadius: 8, padding: 12, marginBottom: 12 },
  bannerSite: { fontSize: 15, fontWeight: "600", color: "#065F46" },
  bannerTime: { fontSize: 13, color: "#047857", marginTop: 2 },
  history: { marginTop: 8 },
  error: { fontSize: 14, color: "#DC2626", marginTop: 12 },
});
