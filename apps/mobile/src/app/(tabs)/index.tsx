import { Text, View, StyleSheet } from "react-native";
import { Screen } from "../../components/ui/Screen";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../lib/authContext";
import { strings } from "../../strings";

// Balances/pending-count/next-leave summary lands in 1.6b - this sub-step
// (1.6a) just proves the authenticated shell and logout work end to end.
export default function HomeScreen() {
  const { user, logout } = useAuth();

  return (
    <Screen>
      <Text style={styles.greeting}>
        {strings.home.greeting}, {user?.email ?? user?.id}
      </Text>
      <View style={styles.button}>
        <Button title={strings.common.logout} variant="secondary" onPress={() => logout()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 20, fontWeight: "600", color: "#111827" },
  button: { marginTop: 24, minWidth: 160 },
});
