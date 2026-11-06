import { Alert, StyleSheet, Text, View } from "react-native";
import { formatDuration, formatTime, type AttendanceRecordDto, type AttendanceTodayDto } from "@employee-saas/shared";
import { ApiClientError } from "../lib/apiClient";
import { getAttendanceErrorMessage, useAttendanceActions, useAttendanceToday } from "../lib/attendance";
import { useCompanyTimezone } from "../lib/theme";
import { strings } from "../strings";
import { AttendanceStatusChip } from "./AttendanceStatusChip";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

function scheduleLine(today: AttendanceTodayDto, timezone: string): string {
  const { dayType, scheduledStartAt, scheduledEndAt, isHalfDayLeave } = today.schedule;
  if (dayType === "OFF") return strings.attendance.dayOff;
  if (dayType === "HOLIDAY") return strings.attendance.holiday;
  if (dayType === "ON_LEAVE") return strings.attendance.onLeave;
  const times = `${formatTime(scheduledStartAt!, timezone)} - ${formatTime(scheduledEndAt!, timezone)}`;
  return isHalfDayLeave ? `${times} (${strings.attendance.halfDayLeave})` : times;
}

function TimesRow({ record, timezone }: { record: AttendanceRecordDto; timezone: string }) {
  return (
    <View style={styles.times}>
      <Text style={styles.time}>
        {strings.attendance.checkedIn} {formatTime(record.checkInAt!, timezone)}
      </Text>
      {record.checkOutAt ? (
        <Text style={styles.time}>
          {strings.attendance.checkedOut} {formatTime(record.checkOutAt, timezone)}
        </Text>
      ) : null}
      {record.workedMinutes !== null ? (
        <Text style={styles.time}>
          {strings.attendance.worked} {formatDuration(record.workedMinutes)}
        </Text>
      ) : null}
    </View>
  );
}

/** Home's attendance card. The server decides what's on offer (`nextAction`), so the
 * app and the API can't disagree about where the employee's day stands. */
export function AttendanceCard() {
  const timezone = useCompanyTimezone();
  const todayQuery = useAttendanceToday(true);
  const { checkIn, checkOut } = useAttendanceActions();
  const today = todayQuery.data;
  const record = today?.record ?? null;
  const pending = checkIn.isPending || checkOut.isPending;
  const actionError = checkIn.error ?? checkOut.error;

  /** There's one check-in/out pair a day, so a mistaken tap can't be undone without HR. */
  function confirmCheckOut() {
    Alert.alert(strings.attendance.checkOutConfirmTitle, strings.attendance.checkOutConfirmMessage, [
      { text: strings.common.cancel, style: "cancel" },
      {
        text: strings.attendance.checkOut,
        style: "destructive",
        onPress: () => {
          checkIn.reset();
          checkOut.mutate();
        },
      },
    ]);
  }

  // The module was switched off after this screen loaded.
  if (todayQuery.error instanceof ApiClientError && todayQuery.error.code === "MODULE_DISABLED") {
    return null;
  }

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title}>{strings.attendance.title}</Text>
        {record?.checkInAt ? <AttendanceStatusChip record={record} /> : null}
      </View>

      {!today ? (
        <Text style={styles.muted}>
          {todayQuery.isError ? getAttendanceErrorMessage(todayQuery.error) : strings.common.loading}
        </Text>
      ) : (
        <>
          <Text style={styles.schedule}>
            {strings.attendance.schedule}: {scheduleLine(today, timezone)}
          </Text>
          {record?.checkInAt ? <TimesRow record={record} timezone={timezone} /> : null}

          {today.nextAction === "CHECK_IN" ? (
            <Button
              title={strings.attendance.checkIn}
              loading={pending}
              onPress={() => {
                checkOut.reset();
                checkIn.mutate();
              }}
            />
          ) : null}
          {today.nextAction === "CHECK_OUT" ? (
            <Button
              title={strings.attendance.checkOut}
              loading={pending}
              onPress={confirmCheckOut}
            />
          ) : null}
          {today.nextAction === "DONE" ? <Text style={styles.muted}>{strings.attendance.done}</Text> : null}
          {today.nextAction === "DAY_CLOSED" ? <Text style={styles.muted}>{strings.attendance.dayClosed}</Text> : null}
        </>
      )}

      {actionError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {getAttendanceErrorMessage(actionError)}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 14, fontWeight: "600", color: "#374151" },
  schedule: { fontSize: 14, color: "#6B7280", marginBottom: 12 },
  times: { marginBottom: 12 },
  time: { fontSize: 15, color: "#111827", paddingVertical: 2 },
  muted: { fontSize: 14, color: "#6B7280" },
  error: { fontSize: 14, color: "#DC2626", marginTop: 12 },
});
