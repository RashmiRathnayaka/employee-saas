import { useState } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { shouldShowLocationDisclosure } from "../lib/location";
import { acknowledgeLocationDisclosure } from "../lib/secureStore";
import { strings } from "../strings";
import { LocationDisclosure } from "./LocationDisclosure";
import { Button } from "./ui/Button";

/**
 * A tap that needs location explains why first, the first time, before the OS asks
 * (architecture-phase2 §3.4). Every button that reads the location goes through this,
 * so none of them can skip it. `send` does the real work once the tap may go ahead.
 *
 * Render `disclosure` somewhere in the screen. It's a full-screen modal.
 */
export function useLocationGate<Tap>(send: (tap: Tap) => void) {
  const [preparing, setPreparing] = useState(false);
  const [waiting, setWaiting] = useState<{ tap: Tap } | null>(null);

  async function start(tap: Tap, gpsRequired: boolean) {
    if (gpsRequired) {
      setPreparing(true);
      const showDisclosure = await shouldShowLocationDisclosure().catch(() => false);
      setPreparing(false);
      if (showDisclosure) {
        setWaiting({ tap });
        return;
      }
    }
    send(tap);
  }

  async function continueFromDisclosure() {
    const { tap } = waiting!;
    await acknowledgeLocationDisclosure();
    setWaiting(null);
    send(tap);
  }

  const disclosure = (
    <Modal visible={waiting !== null} animationType="slide" onRequestClose={() => setWaiting(null)}>
      <ScrollView contentContainerStyle={styles.disclosure}>
        <LocationDisclosure />
        <View style={styles.disclosureButtons}>
          <Button title={strings.location.continue} onPress={() => void continueFromDisclosure()} />
          <Button title={strings.location.notNow} variant="secondary" onPress={() => setWaiting(null)} />
        </View>
      </ScrollView>
    </Modal>
  );

  return { start, preparing, disclosure };
}

const styles = StyleSheet.create({
  disclosure: { flexGrow: 1, justifyContent: "center", padding: 24 },
  disclosureButtons: { gap: 12, marginTop: 12 },
});
