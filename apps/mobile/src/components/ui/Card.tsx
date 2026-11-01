import { StyleSheet, View, type ViewProps } from "react-native";

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style as object]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    marginBottom: 16,
  },
});
