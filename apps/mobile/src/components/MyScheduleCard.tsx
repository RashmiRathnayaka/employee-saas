import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDate } from "@employee-saas/shared";
import { scheduleDayText, useMySchedule } from "../lib/schedule";
import { useCompanyTimezone } from "../lib/theme";
import { strings } from "../strings";
import { Card } from "./ui/Card";

const DAYS_SHOWN_FIRST = 3;

/** The next 14 days. It starts with the next few so that the attendance history below
 * stays in reach, since that's what most people open this tab for. */
export function MyScheduleCard({ enabled }: { enabled: boolean }) {
  const timezone = useCompanyTimezone();
  const query = useMySchedule(enabled);
  const [showAll, setShowAll] = useState(false);

  // The history below has its own error state, and this card isn't worth a second one.
  if (query.isError) {
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>{strings.schedule.title}</Text>
        <Text style={styles.muted}>{strings.schedule.loadError}</Text>
      </Card>
    );
  }
  if (!query.data) return null;

  const { schedule, days } = query.data;
  const shown = showAll ? days : days.slice(0, DAYS_SHOWN_FIRST);

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{strings.schedule.title}</Text>
      <Text style={styles.muted}>{schedule.source === "OVERRIDE" ? strings.schedule.ownHours : strings.schedule.companyHours}</Text>

      <View style={styles.days}>
        {shown.map((day, index) => (
          <View key={day.date} style={styles.day}>
            <Text style={styles.date}>{index === 0 ? strings.schedule.today : formatDate(day.date, timezone)}</Text>
            <Text style={styles.hours}>{scheduleDayText(day, timezone)}</Text>
          </View>
        ))}
      </View>

      <Pressable accessibilityRole="button" onPress={() => setShowAll((value) => !value)} style={styles.toggle}>
        <Text style={styles.toggleText}>{showAll ? strings.schedule.showLess : strings.schedule.showAll}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 16 },
  title: { fontSize: 14, fontWeight: "600", color: "#374151" },
  muted: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  days: { marginTop: 8 },
  day: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, gap: 12 },
  date: { fontSize: 14, color: "#111827" },
  hours: { fontSize: 14, color: "#374151", flexShrink: 1, textAlign: "right" },
  toggle: { paddingTop: 8 },
  toggleText: { fontSize: 14, fontWeight: "600", color: "#2563EB" },
});
