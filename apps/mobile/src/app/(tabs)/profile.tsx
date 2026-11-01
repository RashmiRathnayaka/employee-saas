import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmployeeDto } from "@employee-saas/shared";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { ErrorView, LoadingView } from "../../components/ui/StateViews";
import { useEmployeeMe } from "../../lib/queries";
import { api } from "../../lib/apiClient";
import { getErrorMessage } from "../../lib/errorMapping";
import { formatDate } from "../../lib/formatDate";
import { strings } from "../../strings";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const employeeQuery = useEmployeeMe();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [savedMessage, setSavedMessage] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (employeeQuery.data) {
      setPhone(employeeQuery.data.phone ?? "");
    }
  }, [employeeQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => api.patch<{ employee: EmployeeDto }>("/employees/me", { phone: phone.trim() || null }),
    onSuccess: async (res) => {
      queryClient.setQueryData(["employee", "me"], { employee: res.employee });
      setEditing(false);
      setFormError(null);
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2500);
    },
    onError: (error) => setFormError(getErrorMessage(error)),
  });

  if (employeeQuery.isLoading) {
    return (
      <Screen padded={false}>
        <LoadingView />
      </Screen>
    );
  }

  if (employeeQuery.isError || !employeeQuery.data) {
    return (
      <Screen padded={false}>
        <ErrorView message={strings.common.somethingWentWrong} onRetry={() => employeeQuery.refetch()} />
      </Screen>
    );
  }

  const employee = employeeQuery.data;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={employeeQuery.isRefetching} onRefresh={() => void employeeQuery.refetch()} />}
      >
        <Card>
          <Field label={strings.profile.employeeCode} value={employee.employeeCode} />
          <Field label={strings.profile.department} value={employee.department?.name ?? strings.profile.notSet} />
          <Field label={strings.profile.designation} value={employee.designation?.name ?? strings.profile.notSet} />
          <Field
            label={strings.profile.manager}
            value={employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : strings.profile.notSet}
          />
          <Field label={strings.profile.joiningDate} value={formatDate(employee.joiningDate)} />
        </Card>

        <Card>
          {editing ? (
            <>
              <TextField
                label={strings.profile.phone}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                error={formError ?? undefined}
              />
              <View style={styles.buttonRow}>
                <View style={styles.buttonHalf}>
                  <Button
                    title={strings.common.cancel}
                    variant="secondary"
                    onPress={() => {
                      setEditing(false);
                      setFormError(null);
                      setPhone(employee.phone ?? "");
                    }}
                  />
                </View>
                <View style={styles.buttonHalf}>
                  <Button
                    title={saveMutation.isPending ? strings.profile.saving : strings.profile.save}
                    loading={saveMutation.isPending}
                    onPress={() => saveMutation.mutate()}
                  />
                </View>
              </View>
            </>
          ) : (
            <>
              <Field label={strings.profile.phone} value={employee.phone ?? strings.profile.notSet} />
              {savedMessage ? <Text style={styles.saved}>{strings.profile.saved}</Text> : null}
              <View style={styles.editButton}>
                <Button title={strings.profile.edit} variant="secondary" onPress={() => setEditing(true)} />
              </View>
            </>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, color: "#6B7280", textTransform: "uppercase" },
  fieldValue: { fontSize: 15, color: "#111827", marginTop: 2 },
  editButton: { marginTop: 8, alignSelf: "flex-start", minWidth: 120 },
  buttonRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  buttonHalf: { flex: 1 },
  saved: { color: "#16A34A", fontSize: 13, marginTop: 4 },
});
