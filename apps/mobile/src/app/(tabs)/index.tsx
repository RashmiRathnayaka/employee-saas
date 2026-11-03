import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { DEFAULT_TIMEZONE, formatDate, todayInTimezone } from "@employee-saas/shared";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ErrorView, LoadingView } from "../../components/ui/StateViews";
import { useAuth } from "../../lib/authContext";
import { useCompany } from "../../lib/theme";
import { useEmployeeMe, useLeaveBalances, useLeaveRequests, useLeaveTypes } from "../../lib/queries";
import { useUnreadNotificationCount } from "../../lib/notifications";
import { strings } from "../../strings";

export default function HomeScreen() {
  const { logout } = useAuth();
  const { data: company } = useCompany();
  const employeeQuery = useEmployeeMe();
  const balancesQuery = useLeaveBalances();
  const leaveTypesQuery = useLeaveTypes();
  const requestsQuery = useLeaveRequests(1, 100);
  const unreadCountQuery = useUnreadNotificationCount();
  const { refetch: refetchUnreadCount } = unreadCountQuery;

  // Coming back to Home (e.g. from the notifications screen or another tab)
  // refreshes the bell's badge.
  useFocusEffect(
    useCallback(() => {
      void refetchUnreadCount();
    }, [refetchUnreadCount]),
  );

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      employeeQuery.refetch(),
      balancesQuery.refetch(),
      leaveTypesQuery.refetch(),
      requestsQuery.refetch(),
      refetchUnreadCount(),
    ]);
    setRefreshing(false);
  }, [employeeQuery, balancesQuery, leaveTypesQuery, requestsQuery]);

  const pendingCount = useMemo(() => {
    const requests = requestsQuery.data?.data ?? [];
    return requests.filter((r) => r.status === "PENDING_MANAGER" || r.status === "PENDING_HR").length;
  }, [requestsQuery.data]);

  const nextUpcomingLeave = useMemo(() => {
    const requests = requestsQuery.data?.data ?? [];
    const today = todayInTimezone(company?.timezone ?? DEFAULT_TIMEZONE);
    return requests
      .filter((r) => r.status === "APPROVED" && r.startDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  }, [requestsQuery.data, company?.timezone]);

  const isLoading = employeeQuery.isLoading || balancesQuery.isLoading || requestsQuery.isLoading;
  const isError = employeeQuery.isError || balancesQuery.isError || requestsQuery.isError;

  if (isLoading) {
    return (
      <Screen padded={false}>
        <LoadingView />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen padded={false}>
        <ErrorView message={strings.common.somethingWentWrong} onRetry={onRefresh} />
      </Screen>
    );
  }

  const employee = employeeQuery.data;
  const balances = balancesQuery.data ?? [];
  const leaveTypes = leaveTypesQuery.data ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.greeting}>
          {strings.home.greeting}, {employee?.firstName}
        </Text>

        <Card>
          <Text style={styles.cardTitle}>{strings.home.balancesTitle}</Text>
          {balances.length === 0 ? (
            <Text style={styles.muted}>{strings.common.noData}</Text>
          ) : (
            balances.map((balance) => {
              const leaveType = leaveTypes.find((lt) => lt.id === balance.leaveTypeId);
              return (
                <View key={balance.id} style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>{leaveType?.name ?? balance.leaveTypeId}</Text>
                  <Text style={styles.balanceValue}>
                    {balance.availableDays} {strings.common.days} {strings.home.availableOf}
                  </Text>
                </View>
              );
            })
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>{strings.home.pendingRequests}</Text>
          <Text style={styles.bigNumber}>
            {pendingCount === 0 ? strings.home.pendingRequestsCount_zero : pendingCount}
          </Text>
        </Card>

        <Card style={styles.lastCard}>
          <Text style={styles.cardTitle}>{strings.home.nextLeaveTitle}</Text>
          {nextUpcomingLeave ? (
            <Text style={styles.muted}>
              {formatDate(nextUpcomingLeave.startDate, company?.timezone)} -{" "}
              {formatDate(nextUpcomingLeave.endDate, company?.timezone)}
            </Text>
          ) : (
            <Text style={styles.muted}>{strings.home.noUpcomingLeave}</Text>
          )}
        </Card>

        <Button title={strings.common.logout} variant="secondary" onPress={() => logout()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  greeting: { fontSize: 20, fontWeight: "600", color: "#111827", marginBottom: 16 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 8 },
  muted: { fontSize: 14, color: "#6B7280" },
  bigNumber: { fontSize: 28, fontWeight: "700", color: "#111827" },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  balanceLabel: { fontSize: 14, color: "#111827" },
  balanceValue: { fontSize: 14, color: "#6B7280" },
  lastCard: { marginBottom: 24 },
});
