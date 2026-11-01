import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerChangeEvent,
} from "@react-native-community/datetimepicker";
import { toLocalIsoDate } from "../../lib/formatDate";
import { strings } from "../../strings";

type DateFieldProps = {
  label: string;
  /** ISO date (YYYY-MM-DD), or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  minimumDate?: Date;
  error?: string;
};

export function DateField({ label, value, onChange, minimumDate, error }: DateFieldProps) {
  // Only read on iOS, which renders the picker inline below. Android never
  // sets this - see openPicker().
  const [show, setShow] = useState(false);
  const dateValue = value ? new Date(`${value}T00:00:00`) : new Date();

  // `onChange` is deprecated in favour of these two, which split what it
  // used to encode in event.type - onValueChange only ever fires with an
  // actual picked date, so there's no "set" check left to get wrong.
  function handleValueChange(_event: DateTimePickerChangeEvent, selectedDate: Date) {
    onChange(toLocalIsoDate(selectedDate));
    setShow(false);
  }

  function handleDismiss() {
    setShow(false);
  }

  function openPicker() {
    if (Platform.OS === "android") {
      // Rendering <DateTimePicker> inline on Android (as this component
      // used to, matching this library's own example) ties the native
      // dialog's lifecycle to React's render tree. Reproduced on a real
      // device: navigating the dialog to a different month, or anything
      // else that re-renders the surrounding form while the dialog is
      // open (react-hook-form's watch() fires on every keystroke; the
      // debounced total-days preview settles mid-interaction too),
      // remounts the element and snaps the selection straight back to
      // `value` - the dialog could never actually keep a new pick.
      // DateTimePickerAndroid.open() is a single imperative native call
      // with no element in the React tree at all, so no parent re-render
      // can touch it once it's open - this is also the API this library
      // recommends for Android.
      DateTimePickerAndroid.open({
        value: dateValue,
        mode: "date",
        minimumDate,
        onValueChange: handleValueChange,
        onDismiss: handleDismiss,
      });
    } else {
      setShow(true);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.input, error ? styles.inputError : null]}
        onPress={openPicker}
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
      {Platform.OS !== "android" && show ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          onValueChange={handleValueChange}
          onDismiss={handleDismiss}
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
