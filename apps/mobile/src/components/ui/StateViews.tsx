import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { strings } from "../../strings";

export function LoadingView() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.message}>{strings.common.loading}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.message} accessibilityRole="alert">
        {message}
      </Text>
      <View style={styles.retryButton}>
        <Button title={strings.common.retry} onPress={onRetry} />
      </View>
    </View>
  );
}

export function EmptyView({ message }: { message?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.message}>{message ?? strings.common.noData}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  message: {
    textAlign: "center",
    color: "#4B5563",
    fontSize: 15,
    marginTop: 12,
  },
  retryButton: {
    marginTop: 16,
    minWidth: 140,
  },
});
