import { Text, View, StyleSheet } from "react-native";
import { Redirect, router } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChangePasswordRequestSchema, type ChangePasswordRequest } from "@employee-saas/shared";
import { Screen } from "../components/ui/Screen";
import { TextField } from "../components/ui/TextField";
import { Button } from "../components/ui/Button";
import { api } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { applyApiErrorToForm, getErrorMessage } from "../lib/errorMapping";
import { strings } from "../strings";

export default function ChangePasswordScreen() {
  const { status, user, refreshMe } = useAuth();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(ChangePasswordRequestSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (user && !user.mustChangePassword) return <Redirect href="/(tabs)" />;

  const onSubmit = async (data: ChangePasswordRequest) => {
    try {
      await api.post("/auth/change-password", data);
      await refreshMe();
      router.replace("/(tabs)");
    } catch (error) {
      if (!applyApiErrorToForm(error, setError)) {
        setError("currentPassword", { type: "server", message: getErrorMessage(error) });
      }
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>{strings.changePassword.title}</Text>
        <Text style={styles.subtitle}>{strings.changePassword.subtitle}</Text>
      </View>

      <Controller
        control={control}
        name="currentPassword"
        render={({ field }) => (
          <TextField
            label={strings.changePassword.currentPassword}
            secureTextEntry
            value={field.value}
            onChangeText={field.onChange}
            error={errors.currentPassword?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="newPassword"
        render={({ field }) => (
          <TextField
            label={strings.changePassword.newPassword}
            secureTextEntry
            value={field.value}
            onChangeText={field.onChange}
            error={errors.newPassword?.message}
          />
        )}
      />

      <Button
        title={isSubmitting ? strings.changePassword.submitting : strings.changePassword.submit}
        loading={isSubmitting}
        onPress={() => handleSubmit(onSubmit)()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 24 },
  title: { fontSize: 24, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 15, color: "#6B7280", marginTop: 4 },
});
