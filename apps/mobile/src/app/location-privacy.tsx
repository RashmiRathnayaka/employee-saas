import { useEffect, useState } from "react";
import { AppState, Linking, ScrollView, StyleSheet, Text } from "react-native";
import { LocationDisclosure } from "../components/LocationDisclosure";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Screen } from "../components/ui/Screen";
import { getLocationPermissionState, type LocationPermissionState } from "../lib/location";
import { strings } from "../strings";

/** Profile → Location & privacy: the disclosure, always available, and the current OS
 * permission. It reads the permission again on returning from system settings. */
export default function LocationPrivacyScreen() {
  const [permission, setPermission] = useState<LocationPermissionState | null>(null);

  useEffect(() => {
    const refresh = () => void getLocationPermissionState().then(setPermission);
    refresh();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") refresh();
    });
    return () => subscription.remove();
  }, []);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <LocationDisclosure />
        </Card>
        <Card>
          <Text style={styles.label}>{strings.location.permissionLabel}</Text>
          <Text style={styles.value}>{permission ? strings.location.permission[permission] : strings.common.loading}</Text>
          <Button title={strings.location.openSettings} variant="secondary" onPress={() => void Linking.openSettings()} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  label: { fontSize: 12, color: "#6B7280", textTransform: "uppercase" },
  value: { fontSize: 15, color: "#111827", marginTop: 2, marginBottom: 12 },
});
