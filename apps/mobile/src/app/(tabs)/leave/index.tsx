import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { LeaveRequestDto } from "@employee-saas/shared";
import { Screen } from "../../../components/ui/Screen";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { ErrorView, LoadingView, EmptyView } from "../../../components/ui/StateViews";
import { useLeaveBalances, useLeaveRequests, useLeaveTypes } from "../../../lib/queries";
import { leaveStatusLabel } from "../../../lib/leaveStatusLabel";
import { strings } from "../../../strings";

function StatusChip({ status }: { status: LeaveRequestDto["status"] }) {
  return (
    <View style={[styles.chip, chipStyle(status)]}>
      <Text style={styles.chipText}>{leaveStatusLabel(status)}</Text>
    </View>
  );
}

function chipStyle(status: LeaveRequestDto["status"]) {
  switch (status) {
    case "APPROVED":
      return { backgroundColor: "#DCFCE7" };
    case "REJECTED":
    case "REVOKED":
      return { backgroundColor: "#FEE2E2" };
    case "CANCELLED":
      return { backgroundColor: "#F3F4F6" };
    default:
      return { backgroundColor: "#FEF3C7" };
  }
}

export default function LeaveListScreen() {
  const [page, setPage] = useState(1);
  const balancesQuery = useLeaveBalances();
  const leaveTypesQuery = useLeaveTypes();
  const requestsQuery = useLeaveRequests(page);

  const isLoading = balancesQuery.isLoading || requestsQuery.isLoading;
  const isError = balancesQuery.isError || requestsQuery.isError;

  async function onRefresh() {
    await Promise.all([balancesQuery.refetch(), leaveTypesQuery.refetch(), requestsQuery.refetch()]);
  }

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

  const balances = balancesQuery.data ?? [];
  const leaveTypes = leaveTypesQuery.data ?? [];
  const requests = requestsQuery.data?.data ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={requestsQuery.isRefetching} onRefresh={onRefresh} />}
        data={requests}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            <Card>
              <Text style={styles.cardTitle}>{strings.leave.balances}</Text>
              {balances.length === 0 ? (
                <Text style={styles.muted}>{strings.common.noData}</Text>
              ) : (
                balances.map((balance) => {
                  const leaveType = leaveTypes.find((lt) => lt.id === balance.leaveTypeId);
                  return (
                    <View key={balance.id} style={styles.balanceRow}>
                      <Text style={styles.balanceName}>{leaveType?.name ?? balance.leaveTypeId}</Text>
                      <View style={styles.balanceNumbers}>
                        <Text style={styles.balanceNumber}>
                          {strings.leave.available}: {balance.availableDays}
                        </Text>
                        <Text style={styles.balanceNumberMuted}>
                          {strings.leave.pending}: {balance.pendingDays} · {strings.leave.used}: {balance.usedDays}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </Card>
            <View style={styles.applyButton}>
              <Button title={strings.leave.apply} onPress={() => router.push("/leave/apply")} />
            </View>
            <Text style={styles.cardTitle}>{strings.leave.requests}</Text>
          </>
        }
        ListEmptyComponent={<EmptyView message={strings.leave.noRequests} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/leave/${item.id}`)}>
            <Card style={styles.requestCard}>
              <View style={styles.requestHeader}>
                <Text style={styles.requestDates}>
                  {leaveTypes.find((lt) => lt.id === item.leaveTypeId)?.name ?? item.leaveTypeId}
                </Text>
                <StatusChip status={item.status} />
              </View>
              <Text style={styles.muted}>
                {item.startDate} - {item.endDate} ({item.totalDays} {item.totalDays === 1 ? strings.common.day : strings.common.days})
              </Text>
            </Card>
          </Pressable>
        )}
        onEndReached={() => {
          const total = requestsQuery.data?.total ?? 0;
          if (requests.length < total) setPage((p) => p + 1);
        }}
        onEndReachedThreshold={0.4}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 8 },
  muted: { fontSize: 13, color: "#6B7280" },
  balanceRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  balanceName: { fontSize: 14, fontWeight: "500", color: "#111827" },
  balanceNumbers: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  balanceNumber: { fontSize: 13, color: "#111827" },
  balanceNumberMuted: { fontSize: 12, color: "#9CA3AF" },
  applyButton: { marginBottom: 20 },
  requestCard: { marginBottom: 12 },
  requestHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  requestDates: { fontSize: 15, fontWeight: "600", color: "#111827" },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 12, fontWeight: "600", color: "#374151" },
});
