import { Stack } from "expo-router";
import { usePrimaryColor } from "../../../lib/theme";
import { strings } from "../../../strings";

// A notification can open /leave/<id> directly, before the Leave tab was
// ever visited. This keeps the leave list underneath it, so Back goes to
// the list instead of nowhere.
export const unstable_settings = { initialRouteName: "index" };

export default function LeaveLayout() {
  const primaryColor = usePrimaryColor();

  return (
    <Stack screenOptions={{ headerTintColor: primaryColor }}>
      <Stack.Screen name="index" options={{ title: strings.tabs.leave }} />
      <Stack.Screen name="apply" options={{ title: strings.applyLeave.title }} />
      <Stack.Screen name="[id]" options={{ title: strings.leaveDetail.title }} />
    </Stack>
  );
}
