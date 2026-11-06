import { StyleSheet, Text, View } from "react-native";
import type { AttendanceRecordDto, AttendanceStatus } from "@employee-saas/shared";
import { strings } from "../strings";

const BACKGROUND: Record<AttendanceStatus, string> = {
  PRESENT: "#DCFCE7",
  LATE: "#FEF3C7",
  ON_LEAVE: "#E0E7FF",
  HOLIDAY: "#E0E7FF",
  ABSENT: "#FEE2E2",
  INCOMPLETE: "#FEE2E2",
};

export function attendanceStatusLabel(record: Pick<AttendanceRecordDto, "status" | "lateMinutes">): string {
  return record.status === "LATE" ? strings.attendance.lateBy(record.lateMinutes) : strings.attendanceStatus[record.status];
}

export function AttendanceStatusChip({ record }: { record: Pick<AttendanceRecordDto, "status" | "lateMinutes"> }) {
  return (
    <View style={[styles.chip, { backgroundColor: BACKGROUND[record.status] }]}>
      <Text style={styles.text}>{attendanceStatusLabel(record)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  text: { fontSize: 12, fontWeight: "600", color: "#374151" },
});
