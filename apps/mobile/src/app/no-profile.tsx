import { Text, View, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { Screen } from "../components/ui/Screen";
import { Button } from "../components/ui/Button";
import { useAuth } from "../lib/authContext";
import { strings } from "../strings";

export default function NoProfileScreen() {
  const { status, user, logout } = useAuth();

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (user?.mustChangePassword) return <Redirect href="/change-password" />;
  if (user?.employeeId) return <Redirect href="/(tabs)" />;

  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.title}>{strings.noProfile.title}</Text>
        <Text style={styles.message}>{strings.noProfile.message}</Text>
        <View style={styles.button}>
          <Button title={strings.noProfile.logout} variant="secondary" onPress={() => logout()} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700", color: "#111827", textAlign: "center" },
  message: { fontSize: 15, color: "#6B7280", marginTop: 8, textAlign: "center" },
  button: { marginTop: 24, minWidth: 160 },
});
