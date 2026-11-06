import { useState } from "react";
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { SiteSummaryDto } from "@employee-saas/shared";
import { Button } from "../components/ui/Button";
import { Screen } from "../components/ui/Screen";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { TextField } from "../components/ui/TextField";
import { useLocationGate } from "../components/useLocationGate";
import { getAttendanceErrorMessage, isLocationRequiredError } from "../lib/attendance";
import { usePickableSites, useSiteVisitActions } from "../lib/siteVisits";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { strings } from "../strings";

/** Pick an external site to check in at. Tapping one asks first, because a check-in tells
 * the manager, can record the location and can start the day, and only HR can undo it. */
export default function SitePickerScreen() {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search);
  const sites = usePickableSites(debounced);
  const { checkIn } = useSiteVisitActions();
  const gate = useLocationGate<SiteSummaryDto>((site) =>
    checkIn.mutate({ siteId: site.id, gpsRequired: site.gpsRequired }, { onSuccess: () => router.back() }),
  );
  const busy = gate.preparing || checkIn.isPending;
  const list = sites.data?.pages.flatMap((page) => page.data) ?? [];

  function confirmCheckIn(site: SiteSummaryDto) {
    Alert.alert(
      strings.siteVisits.confirmTitle(site.name),
      site.gpsRequired ? strings.siteVisits.confirmMessageWithGps : strings.siteVisits.confirmMessage,
      [
        { text: strings.common.cancel, style: "cancel" },
        { text: strings.siteVisits.confirmAction, onPress: () => void gate.start(site, site.gpsRequired) },
      ],
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.top}>
        <TextField
          label={strings.siteVisits.search}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
        />
        {busy ? <Text style={styles.busy}>{strings.siteVisits.checkingIn}</Text> : null}
        {checkIn.error && !busy ? (
          <Text style={styles.error} accessibilityRole="alert">
            {getAttendanceErrorMessage(checkIn.error)}
          </Text>
        ) : null}
        {isLocationRequiredError(checkIn.error) && !busy ? (
          <View style={styles.settings}>
            <Button title={strings.location.openSettings} variant="secondary" onPress={() => void Linking.openSettings()} />
          </View>
        ) : null}
      </View>

      {sites.isLoading ? (
        <LoadingView />
      ) : sites.isError ? (
        <ErrorView message={getAttendanceErrorMessage(sites.error)} onRetry={() => void sites.refetch()} />
      ) : (
        <FlatList
          testID="site-picker-list"
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          data={list}
          keyExtractor={(site) => site.id}
          ListEmptyComponent={<EmptyView message={debounced.trim() ? strings.siteVisits.noMatches : strings.siteVisits.noSites} />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => confirmCheckIn(item)}
              style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
            >
              <Text style={styles.name}>{item.name}</Text>
              {item.address ? <Text style={styles.detail}>{item.address}</Text> : null}
              {item.gpsRequired ? <Text style={styles.detail}>{strings.siteVisits.locationChecked}</Text> : null}
            </Pressable>
          )}
          onEndReached={() => {
            if (sites.hasNextPage && !sites.isFetchingNextPage) void sites.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
        />
      )}

      {gate.disclosure}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingTop: 16 },
  busy: { fontSize: 14, color: "#6B7280", marginBottom: 12 },
  error: { fontSize: 14, color: "#DC2626", marginBottom: 12 },
  settings: { marginBottom: 12 },
  content: { paddingHorizontal: 20, paddingBottom: 20 },
  row: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  rowPressed: { backgroundColor: "#F3F4F6" },
  name: { fontSize: 15, fontWeight: "600", color: "#111827" },
  detail: { fontSize: 13, color: "#6B7280", marginTop: 2 },
});
