import { StyleSheet, Text, View } from "react-native";
import { useCompanySettings } from "../lib/attendance";
import { strings } from "../strings";

/** What employees are told about location (architecture-phase2 §3.4). Used both before
 * the first permission prompt and under Profile, so the two can't say different things. */
export function LocationDisclosure() {
  const { data: settings } = useCompanySettings();

  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">
        {strings.location.disclosureTitle}
      </Text>
      <Text style={styles.text}>{strings.location.disclosureIntro}</Text>
      {[...strings.location.disclosurePoints, strings.location.retention(settings?.gpsRetentionDays ?? null)].map((point) => (
        <View key={point} style={styles.point}>
          <Text style={styles.bullet}>{"•"}</Text>
          <Text style={[styles.text, styles.pointText]}>{point}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", color: "#111827", marginBottom: 12 },
  text: { fontSize: 15, lineHeight: 22, color: "#374151", marginBottom: 12 },
  point: { flexDirection: "row" },
  bullet: { fontSize: 15, lineHeight: 22, color: "#374151", width: 16 },
  pointText: { flex: 1 },
});
