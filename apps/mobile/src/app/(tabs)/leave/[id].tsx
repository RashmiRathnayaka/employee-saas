import { Alert, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Screen } from "../../../components/ui/Screen";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { ErrorView, LoadingView } from "../../../components/ui/StateViews";
import { UploadProofSection } from "../../../components/UploadProofSection";
import { useLeaveRequestDetail, useLeaveTypes } from "../../../lib/queries";
import { leaveStatusLabel } from "../../../lib/leaveStatusLabel";
import { api } from "../../../lib/apiClient";
import { getErrorMessage } from "../../../lib/errorMapping";
import { formatDate } from "../../../lib/formatDate";
import { strings } from "../../../strings";

export default function LeaveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detailQuery = useLeaveRequestDetail(id);
  const leaveTypesQuery = useLeaveTypes();
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: () => api.patch(`/leave-requests/${id}/cancel`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leave-request", id] }),
        queryClient.invalidateQueries({ queryKey: ["leave-requests", "me"] }),
        queryClient.invalidateQueries({ queryKey: ["leave-balances", "me"] }),
      ]);
    },
    onError: (error) => Alert.alert(strings.common.somethingWentWrong, getErrorMessage(error)),
  });

  function confirmCancel() {
    Alert.alert(strings.leaveDetail.cancel, strings.leaveDetail.cancelConfirm, [
      { text: strings.common.cancel, style: "cancel" },
      { text: strings.common.confirm, style: "destructive", onPress: () => cancelMutation.mutate() },
    ]);
  }

  if (detailQuery.isLoading) {
    return (
      <Screen padded={false}>
        <LoadingView />
      </Screen>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Screen padded={false}>
        <ErrorView message={strings.common.somethingWentWrong} onRetry={() => detailQuery.refetch()} />
      </Screen>
    );
  }

  const { leaveRequest, approvals } = detailQuery.data;
  const leaveTypeName = leaveTypesQuery.data?.find((lt) => lt.id === leaveRequest.leaveTypeId)?.name ?? "-";
  const canCancel = leaveRequest.status === "PENDING_MANAGER" || leaveRequest.status === "PENDING_HR";
  const hasHalfDay = leaveRequest.startHalfDay || leaveRequest.endHalfDay;

  return (
    <Screen>
      <Card>
        <Text style={styles.title}>{leaveTypeName}</Text>
        <Text style={styles.muted}>
          {strings.leaveDetail.dates}: {leaveRequest.startDate} - {leaveRequest.endDate}
        </Text>
        <Text style={styles.muted}>
          {strings.leaveDetail.totalDays}: {leaveRequest.totalDays}
        </Text>
        {hasHalfDay ? <Text style={styles.muted}>{strings.leaveDetail.halfDay}: Yes</Text> : null}
        <Text style={styles.muted}>
          {strings.leaveDetail.reason}: {leaveRequest.reason ?? strings.leaveDetail.noReason}
        </Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>{leaveStatusLabel(leaveRequest.status)}</Text>
        </View>
        {leaveRequest.proofStatus !== "NOT_REQUIRED" ? (
          <>
            <Text style={styles.muted}>{strings.proofStatus[leaveRequest.proofStatus]}</Text>
            {leaveRequest.proofDueAt ? (
              <Text style={styles.muted}>
                {strings.leaveDetail.proofDueBy}: {formatDate(leaveRequest.proofDueAt)}
              </Text>
            ) : null}
          </>
        ) : null}

        {canCancel ? (
          <View style={styles.cancelButton}>
            <Button
              title={strings.leaveDetail.cancel}
              variant="danger"
              loading={cancelMutation.isPending}
              onPress={confirmCancel}
            />
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{strings.leaveDetail.approvalHistory}</Text>
        {approvals.length === 0 ? (
          <Text style={styles.muted}>{strings.leaveDetail.noHistory}</Text>
        ) : (
          approvals.map((approval) => (
            <View key={approval.id} style={styles.approvalRow}>
              <Text style={styles.approvalText}>
                {approval.step} - {approval.decision}
              </Text>
              <Text style={styles.muted}>{formatDate(approval.decidedAt)}</Text>
              {approval.note ? <Text style={styles.approvalNote}>"{approval.note}"</Text> : null}
            </View>
          ))
        )}
      </Card>

      {leaveRequest.proofStatus !== "NOT_REQUIRED" ? (
        <Card>
          <UploadProofSection requestId={id!} proofStatus={leaveRequest.proofStatus} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "700", color: "#111827", marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 8 },
  muted: { fontSize: 14, color: "#6B7280", marginTop: 4 },
  statusRow: { marginTop: 8 },
  statusLabel: { fontSize: 14, fontWeight: "600", color: "#111827" },
  cancelButton: { marginTop: 16 },
  approvalRow: { marginBottom: 10 },
  approvalText: { fontSize: 14, fontWeight: "600", color: "#111827" },
  approvalNote: { fontSize: 13, color: "#4B5563", marginTop: 2 },
});
