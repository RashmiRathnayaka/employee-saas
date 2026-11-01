import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { strings } from "../../strings";

type DateFieldProps = {
  label: string;
  /** ISO date (YYYY-MM-DD), or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  minimumDate?: Date;
  error?: string;
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function DateField({ label, value, onChange, minimumDate, error }: DateFieldProps) {
  const [show, setShow] = useState(false);
  const dateValue = value ? new Date(`${value}T00:00:00`) : new Date();

  function handleChange(event: DateTimePickerEvent, selectedDate?: Date) {
    // Android dismisses its own dialog; iOS shows an inline picker that
    // stays open until the user picks a value or taps away.
    if (Platform.OS === "android") setShow(false);
    if (event.type === "set" && selectedDate) {
      onChange(toIsoDate(selectedDate));
      if (Platform.OS === "ios") setShow(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.input, error ? styles.inputError : null]}
        onPress={() => setShow(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={value ? styles.value : styles.placeholder}>{value || strings.applyLeave.selectDate}</Text>
      </Pressable>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {show ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 6 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  inputError: { borderColor: "#DC2626" },
  value: { fontSize: 16, color: "#111827" },
  placeholder: { fontSize: 16, color: "#9CA3AF" },
  error: { marginTop: 4, fontSize: 13, color: "#DC2626" },
});
