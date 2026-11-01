import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { usePrimaryColor } from "../../lib/theme";

type ButtonProps = PressableProps & {
  title: string;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
};

export function Button({ title, loading, variant = "primary", disabled, style, ...rest }: ButtonProps) {
  const primaryColor = usePrimaryColor();
  const isDisabled = disabled || loading;

  const backgroundColor =
    variant === "primary" ? primaryColor : variant === "danger" ? "#DC2626" : "transparent";
  const textColor = variant === "secondary" ? primaryColor : "#FFFFFF";
  const borderColor = variant === "secondary" ? primaryColor : "transparent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor, borderColor, opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 },
        style as object,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <Text style={[styles.text, { color: textColor }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  text: {
    fontSize: 16,
    fontWeight: "600",
  },
});
