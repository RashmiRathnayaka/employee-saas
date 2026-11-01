import { Redirect } from "expo-router";
import { useAuth } from "../lib/authContext";

export default function Index() {
  const { status, user } = useAuth();

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (user?.mustChangePassword) return <Redirect href="/change-password" />;
  if (!user?.employeeId) return <Redirect href="/no-profile" />;
  return <Redirect href="/(tabs)" />;
}
