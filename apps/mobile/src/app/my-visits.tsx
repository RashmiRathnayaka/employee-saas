import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { formatDate, formatDuration, formatTime, type SiteVisitWithCoordinatesDto } from "@employee-saas/shared";
import { Card } from "../components/ui/Card";
import { Screen } from "../components/ui/Screen";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { getAttendanceErrorMessage, useIsModuleEnabled } from "../lib/attendance";
import { useMyVisits } from "../lib/siteVisits";
import { useCompanyTimezone } from "../lib/theme";
import { strings } from "../strings";

function timesLine(visit: SiteVisitWithCoordinatesDto, timezone: string): string {
  const start = formatTime(visit.checkInAt, timezone);
  if (visit.status === "OPEN") return `${start} - ${strings.siteVisits.status.OPEN}`;
  const end = visit.checkOutAt ? formatTime(visit.checkOutAt, timezone) : strings.attendance.noCheckOut;
  const duration = visit.durationMinutes !== null ? ` · ${formatDuration(visit.durationMinutes)}` : "";
  return `${start} - ${end}${duration}`;
}

/** The two flags about how a visit sits with its day (§1.6). The employee should know
 * HR will see them. GPS flags stay out of this list: they're for HR's views. */
function dayNote(visit: SiteVisitWithCoordinatesDto): string | null {
  if (visit.flags.includes("ON_ABSENT_DAY")) return strings.siteVisits.onAbsentDay;
  if (visit.flags.includes("AFTER_HOURS")) return strings.siteVisits.afterHours;
  return null;
}

export default function MyVisitsScreen() {
  const enabled = useIsModuleEnabled("sites");
  const timezone = useCompanyTimezone();
  const visits = useMyVisits(enabled);
  const { refetch } = visits;

  // A check-in on Home happens outside this screen.
  useFocusEffect(
    useCallback(() => {
      if (enabled) void refetch();
    }, [enabled, refetch]),
  );

  if (visits.isLoading) {
    return (
      <Screen padded={false}>
        <LoadingView />
      </Screen>
    );
  }
  if (visits.isError) {
    return (
      <Screen padded={false}>
        <ErrorView message={getAttendanceErrorMessage(visits.error)} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const rows = visits.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        testID="my-visits"
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(visit) => visit.id}
        refreshControl={<RefreshControl refreshing={visits.isRefetching && !visits.isFetchingNextPage} onRefresh={() => void refetch()} />}
        ListEmptyComponent={<EmptyView message={strings.siteVisits.noVisits} />}
        renderItem={({ item }) => {
          const note = dayNote(item);
          return (
            <Card style={styles.row}>
              <View style={styles.rowHeader}>
                <Text style={styles.site}>{item.siteName}</Text>
                <Text style={styles.date}>{formatDate(item.workDate, timezone)}</Text>
              </View>
              <Text style={styles.detail}>{timesLine(item, timezone)}</Text>
              {note ? <Text style={styles.note}>{note}</Text> : null}
            </Card>
          );
        }}
        onEndReached={() => {
          if (visits.hasNextPage && !visits.isFetchingNextPage) void visits.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  row: { marginBottom: 12 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 },
  site: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: "#111827" },
  date: { fontSize: 13, color: "#6B7280" },
  detail: { fontSize: 13, color: "#6B7280" },
  note: { fontSize: 13, color: "#B45309", marginTop: 4 },
});
