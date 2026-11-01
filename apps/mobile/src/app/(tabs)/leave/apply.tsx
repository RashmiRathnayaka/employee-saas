import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CreateLeaveRequestSchema, type LeaveRequestDto } from "@employee-saas/shared";
import { Screen } from "../../../components/ui/Screen";
import { Button } from "../../../components/ui/Button";
import { DateField } from "../../../components/ui/DateField";
import { TextField } from "../../../components/ui/TextField";
import { useLeaveTypes } from "../../../lib/queries";
import { usePrimaryColor } from "../../../lib/theme";
import { api } from "../../../lib/apiClient";
import { useDebouncedValue } from "../../../lib/useDebouncedValue";
import { applyApiErrorToForm, getErrorMessage } from "../../../lib/errorMapping";
import { strings } from "../../../strings";

// z.input, not z.infer - CreateLeaveRequestSchema's `.default(...)` fields
// are optional on the way in, matching react-hook-form's defaultValues shape.
type CreateLeaveRequestFormValues = z.input<typeof CreateLeaveRequestSchema>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ApplyLeaveScreen() {
  const leaveTypesQuery = useLeaveTypes();
  const primaryColor = usePrimaryColor();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ totalDays: number } | { error: string } | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateLeaveRequestFormValues>({
    resolver: zodResolver(CreateLeaveRequestSchema),
    defaultValues: {
      leaveTypeId: "",
      startDate: "",
      endDate: "",
      startHalfDay: false,
      endHalfDay: false,
      reason: "",
    },
  });

  const [leaveTypeId, startDate, endDate, startHalfDay, endHalfDay] = watch([
    "leaveTypeId",
    "startDate",
    "endDate",
    "startHalfDay",
    "endHalfDay",
  ]);
  const selectedLeaveType = leaveTypesQuery.data?.find((lt) => lt.id === leaveTypeId);
  const isSingleDay = !!startDate && startDate === endDate;

  const debouncedRange = useDebouncedValue({ startDate, endDate, startHalfDay, endHalfDay }, 300);

  useEffect(() => {
    if (!debouncedRange.startDate || !debouncedRange.endDate) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api
      .post<{ totalDays: number }>("/leave-requests/preview", debouncedRange)
      .then((res) => !cancelled && setPreview({ totalDays: res.totalDays }))
      .catch((error) => !cancelled && setPreview({ error: getErrorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [debouncedRange]);

  const submitMutation = useMutation({
    mutationFn: (values: CreateLeaveRequestFormValues) => api.post<{ leaveRequest: LeaveRequestDto }>("/leave-requests", values),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leave-balances", "me"] }),
        queryClient.invalidateQueries({ queryKey: ["leave-requests", "me"] }),
      ]);
      const requestId = res.leaveRequest.id;
      if (selectedLeaveType?.requiresProof) {
        Alert.alert(strings.applyLeave.proofPromptTitle, strings.applyLeave.proofPromptMessage, [
          { text: strings.applyLeave.proofUploadLater, onPress: () => router.replace(`/leave/${requestId}`) },
          { text: strings.applyLeave.proofUploadNow, onPress: () => router.replace(`/leave/${requestId}`) },
        ]);
      } else {
        router.replace(`/leave/${requestId}`);
      }
    },
    onError: (error) => {
      if (!applyApiErrorToForm(error, setError)) {
        Alert.alert(strings.common.somethingWentWrong, getErrorMessage(error));
      }
    },
  });

  // Sets friendly, field-specific messages for the required fields -
  // never the raw zod/regex error (e.g. CreateLeaveRequestSchema's isoDate
  // regex message "must be YYYY-MM-DD", which the resolver would otherwise
  // show for an empty date field - not something to put in front of a
  // user picking from a native date dialog that can't produce a malformed
  // value in the first place). leaveTypeId is a bare z.string() in the
  // schema (no .min(1), since the server-side check is really "does this
  // id exist", not a format rule), so its emptiness is never caught by
  // the resolver at all and has to be checked here regardless.
  //
  // Called from both onSubmit and onInvalid (below) so it still runs even
  // when other fields also fail the schema - react-hook-form only calls
  // onSubmit when the whole form passes the resolver.
  function applyRequiredFieldErrors(): boolean {
    const values = watch();
    let ok = true;
    if (!values.leaveTypeId) {
      setError("leaveTypeId", { type: "required", message: strings.applyLeave.leaveTypeRequired });
      ok = false;
    }
    if (!values.startDate) {
      setError("startDate", { type: "required", message: strings.applyLeave.startDateRequired });
      ok = false;
    }
    if (!values.endDate) {
      setError("endDate", { type: "required", message: strings.applyLeave.endDateRequired });
      ok = false;
    }
    return ok;
  }

  function onInvalid() {
    applyRequiredFieldErrors();
  }

  function onSubmit(values: CreateLeaveRequestFormValues) {
    if (!applyRequiredFieldErrors()) {
      return;
    }
    if (isSingleDay && values.startHalfDay && values.endHalfDay) {
      setError("endHalfDay", { type: "validate", message: strings.applyLeave.halfDaySingleDayOnly });
      return;
    }
    submitMutation.mutate(values);
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>{strings.applyLeave.leaveType}</Text>
        <Controller
          control={control}
          name="leaveTypeId"
          render={({ field }) => (
            <View style={styles.chipRow}>
              {(leaveTypesQuery.data ?? []).map((lt) => {
                const selected = field.value === lt.id;
                return (
                  <Pressable
                    key={lt.id}
                    onPress={() => field.onChange(lt.id)}
                    style={[
                      styles.chip,
                      selected ? { borderColor: primaryColor, backgroundColor: `${primaryColor}1A` } : null,
                    ]}
                  >
                    <Text style={[styles.chipText, selected ? { color: primaryColor } : null]}>{lt.name}</Text>
                  </Pressable>
                );
              })}
              {leaveTypesQuery.data?.length === 0 ? (
                <Text style={styles.muted}>{strings.applyLeave.noLeaveTypes}</Text>
              ) : null}
            </View>
          )}
        />
        {errors.leaveTypeId ? (
          <Text style={styles.error} accessibilityRole="alert">
            {errors.leaveTypeId.message}
          </Text>
        ) : null}

        <Controller
          control={control}
          name="startDate"
          render={({ field }) => (
            <DateField
              label={strings.applyLeave.startDate}
              value={field.value ?? ""}
              onChange={field.onChange}
              minimumDate={selectedLeaveType?.allowPastDates ? undefined : new Date(todayIso())}
              error={errors.startDate?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="endDate"
          render={({ field }) => (
            <DateField
              label={strings.applyLeave.endDate}
              value={field.value ?? ""}
              onChange={field.onChange}
              minimumDate={startDate ? new Date(`${startDate}T00:00:00`) : undefined}
              error={errors.endDate?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="startHalfDay"
          render={({ field }) => (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{strings.applyLeave.startHalfDay}</Text>
              <Switch
                value={!!field.value}
                onValueChange={(v) => {
                  field.onChange(v);
                  if (v && isSingleDay) setValue("endHalfDay", false);
                }}
              />
            </View>
          )}
        />
        <Controller
          control={control}
          name="endHalfDay"
          render={({ field }) => (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{strings.applyLeave.endHalfDay}</Text>
              <Switch
                value={!!field.value}
                onValueChange={(v) => {
                  field.onChange(v);
                  if (v && isSingleDay) setValue("startHalfDay", false);
                }}
              />
            </View>
          )}
        />
        {errors.endHalfDay ? (
          <Text style={styles.error} accessibilityRole="alert">
            {errors.endHalfDay.message}
          </Text>
        ) : null}

        <Controller
          control={control}
          name="reason"
          render={({ field }) => (
            <TextField
              label={strings.applyLeave.reason}
              value={field.value ?? ""}
              onChangeText={field.onChange}
              multiline
              numberOfLines={3}
              error={errors.reason?.message}
            />
          )}
        />

        {preview ? (
          <Text style={styles.preview}>
            {"totalDays" in preview ? (
              <>
                {strings.applyLeave.totalDaysPreview}: {preview.totalDays}
              </>
            ) : (
              <Text style={styles.error}>{preview.error}</Text>
            )}
          </Text>
        ) : null}

        <Button
          title={isSubmitting ? strings.applyLeave.submitting : strings.applyLeave.submit}
          loading={isSubmitting}
          onPress={() => handleSubmit(onSubmit, onInvalid)()}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  label: { fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { fontSize: 14, color: "#374151" },
  muted: { fontSize: 14, color: "#6B7280" },
  error: { fontSize: 13, color: "#DC2626", marginBottom: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  switchLabel: { fontSize: 15, color: "#111827", flex: 1, marginRight: 12 },
  preview: { fontSize: 15, fontWeight: "600", color: "#111827", marginBottom: 16 },
});
