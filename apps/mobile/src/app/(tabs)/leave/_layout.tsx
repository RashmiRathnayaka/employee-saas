import { Stack } from "expo-router";
import { usePrimaryColor } from "../../../lib/theme";
import { strings } from "../../../strings";

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
