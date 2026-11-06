import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { formatDate, formatDuration, formatTime } from "@employee-saas/shared";
import { AttendanceStatusChip } from "../../components/AttendanceStatusChip";
import { MyScheduleCard } from "../../components/MyScheduleCard";
import { Card } from "../../components/ui/Card";
import { Screen } from "../../components/ui/Screen";
import { EmptyView, ErrorView, LoadingView } from "../../components/ui/StateViews";
import { getAttendanceErrorMessage, useAttendanceHistory, useIsModuleEnabled } from "../../lib/attendance";
import { useMySchedule } from "../../lib/schedule";
import { useCompanyTimezone } from "../../lib/theme";
import { strings } from "../../strings";

export default function AttendanceScreen() {
  const enabled = useIsModuleEnabled("attendance");
  const timezone = useCompanyTimezone();
  const history = useAttendanceHistory(enabled);
  const { refetch: refetchHistory } = history;
  // Shares its query with the card, which sits inside the list.
  const { refetch: refetchSchedule } = useMySchedule(enabled);
  const refetch = useCallback(() => Promise.all([refetchHistory(), refetchSchedule()]), [refetchHistory, refetchSchedule]);

  // A check-in on Home, or HR changing a schedule, happens outside this screen.
  useFocusEffect(
    useCallback(() => {
      if (enabled) void refetch();
    }, [enabled, refetch]),
  );

  if (history.isLoading) {
    return (
      <Screen padded={false}>
        <LoadingView />
      </Screen>
    );
  }
  if (history.isError) {
    return (
      <Screen padded={false}>
        <ErrorView message={getAttendanceErrorMessage(history.error)} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const records = history.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        testID="attendance-history"
        contentContainerStyle={styles.content}
        data={records}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={history.isRefetching && !history.isFetchingNextPage} onRefresh={() => void refetch()} />}
        ListHeaderComponent={<MyScheduleCard enabled={enabled} />}
        ListEmptyComponent={<EmptyView message={strings.attendance.noHistory} />}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.date}>{formatDate(item.workDate, timezone)}</Text>
              <AttendanceStatusChip record={item} />
            </View>
            {item.checkInAt ? (
              <Text style={styles.detail}>
                {formatTime(item.checkInAt, timezone)} - {item.checkOutAt ? formatTime(item.checkOutAt, timezone) : strings.attendance.noCheckOut}
                {item.workedMinutes !== null ? ` · ${formatDuration(item.workedMinutes)}` : ""}
              </Text>
            ) : null}
            {item.isCorrected ? <Text style={styles.corrected}>{strings.attendance.corrected}</Text> : null}
          </Card>
        )}
        onEndReached={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  row: { marginBottom: 12 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  date: { fontSize: 15, fontWeight: "600", color: "#111827" },
  detail: { fontSize: 13, color: "#6B7280" },
  corrected: { fontSize: 13, color: "#B45309", marginTop: 4 },
});
