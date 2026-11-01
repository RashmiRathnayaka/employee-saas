import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../lib/authContext";
import { usePrimaryColor } from "../../lib/theme";
import { strings } from "../../strings";

export default function TabsLayout() {
  const { status, user } = useAuth();
  const primaryColor = usePrimaryColor();

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (user?.mustChangePassword) return <Redirect href="/change-password" />;
  if (!user?.employeeId) return <Redirect href="/no-profile" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: primaryColor, headerTintColor: primaryColor }}>
      <Tabs.Screen name="index" options={{ title: strings.tabs.home }} />
      {/* headerShown: false - the nested leave/_layout.tsx Stack owns its own
          headers (index/apply/[id]); showing both would double up. */}
      <Tabs.Screen name="leave" options={{ title: strings.tabs.leave, headerShown: false }} />
      <Tabs.Screen name="profile" options={{ title: strings.tabs.profile }} />
    </Tabs>
  );
}
