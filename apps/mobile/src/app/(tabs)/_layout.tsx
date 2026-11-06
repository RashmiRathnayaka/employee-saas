import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useIsModuleEnabled } from "../../lib/attendance";
import { useAuth } from "../../lib/authContext";
import { usePrimaryColor } from "../../lib/theme";
import { strings } from "../../strings";
import { NotificationBell } from "../../components/NotificationBell";

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Filled icon for the active tab, outline for the others (the usual iOS/Android convention). */
function tabIcon(filled: IoniconName, outline: IoniconName) {
  function TabIcon({ color, size, focused }: { color: string; size: number; focused: boolean }) {
    return <Ionicons name={focused ? filled : outline} size={size} color={color} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const { status, user } = useAuth();
  const primaryColor = usePrimaryColor();
  const attendanceEnabled = useIsModuleEnabled("attendance");

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (user?.mustChangePassword) return <Redirect href="/change-password" />;
  if (!user?.employeeId) return <Redirect href="/no-profile" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: primaryColor, headerTintColor: primaryColor }}>
      <Tabs.Screen
        name="index"
        options={{
          title: strings.tabs.home,
          tabBarIcon: tabIcon("home", "home-outline"),
          headerRight: () => <NotificationBell />,
        }}
      />
      {/* headerShown: false - the nested leave/_layout.tsx Stack owns its own
          headers (index/apply/[id]); showing both would double up. */}
      <Tabs.Screen
        name="leave"
        options={{ title: strings.tabs.leave, headerShown: false, tabBarIcon: tabIcon("calendar", "calendar-outline") }}
      />
      {/* href: null is how Expo Router hides a tab. */}
      <Tabs.Screen
        name="attendance"
        options={{
          title: strings.tabs.attendance,
          href: attendanceEnabled ? undefined : null,
          tabBarIcon: tabIcon("time", "time-outline"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: strings.tabs.profile, tabBarIcon: tabIcon("person", "person-outline") }}
      />
    </Tabs>
  );
}
