import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { formatUnreadBadge } from "@employee-saas/shared";
import { useUnreadNotificationCount } from "../lib/notifications";
import { usePrimaryColor } from "../lib/theme";
import { strings } from "../strings";

/** Home header bell (Ionicons "notifications-outline") with an unread
 * badge. Opens the notifications screen. */
export function NotificationBell() {
  const countQuery = useUnreadNotificationCount();
  const count = countQuery.data ?? 0;
  const badge = formatUnreadBadge(count);
  const primaryColor = usePrimaryColor();

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? strings.notifications.bellLabelUnread(count) : strings.notifications.bellLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="notifications-outline" size={24} color={primaryColor} />
      {badge ? (
        <View style={styles.badge} testID="notification-badge">
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { marginRight: 12, padding: 4 },
  pressed: { opacity: 0.6 },
  badge: {
    position: "absolute",
    top: -2,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
});
