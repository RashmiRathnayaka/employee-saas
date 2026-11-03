import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "../lib/authContext";
import { queryClient } from "../lib/queryClient";
import { useAppStateFocus } from "../lib/notifications";
import { usePrimaryColor } from "../lib/theme";
import { strings } from "../strings";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();
  const primaryColor = usePrimaryColor();
  // App back in the foreground -> refetch the unread count (see notifications.ts).
  useAppStateFocus();

  useEffect(() => {
    if (status !== "loading") {
      SplashScreen.hideAsync();
    }
  }, [status]);

  if (status === "loading") {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="change-password" />
      <Stack.Screen name="no-profile" />
      <Stack.Screen name="(tabs)" />
      {/* Outside (tabs) so it opens full-screen over Home, with a back button. */}
      <Stack.Screen
        name="notifications"
        options={{ headerShown: true, title: strings.notifications.title, headerTintColor: primaryColor }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="auto" />
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}
