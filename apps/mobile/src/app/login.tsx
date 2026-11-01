import { useEffect, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginRequestSchema, type LoginRequest } from "@employee-saas/shared";
import { Screen } from "../components/ui/Screen";
import { TextField } from "../components/ui/TextField";
import { Button } from "../components/ui/Button";
import { useAuth, isApiClientError } from "../lib/authContext";
import { getLastCompanyCode, setLastCompanyCode } from "../lib/secureStore";
import { strings } from "../strings";

export default function LoginScreen() {
  const { status, user, login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { companyCode: "", identifier: "", password: "" },
  });

  useEffect(() => {
    getLastCompanyCode().then((code) => {
      if (code) setValue("companyCode", code);
    });
  }, [setValue]);

  if (status === "authenticated") {
    if (user?.mustChangePassword) return <Redirect href="/change-password" />;
    if (!user?.employeeId) return <Redirect href="/no-profile" />;
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async (data: LoginRequest) => {
    setFormError(null);
    try {
      await login(data.companyCode, data.identifier, data.password);
      await setLastCompanyCode(data.companyCode);
    } catch (error) {
      if (isApiClientError(error) && error.code === "NETWORK_ERROR") {
        setFormError(strings.errors.network);
      } else if (isApiClientError(error) && error.code === "RATE_LIMITED") {
        setFormError(strings.login.rateLimited);
      } else {
        // Deliberately generic - never reveal which part was wrong.
        setFormError(strings.login.genericError);
      }
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>{strings.login.title}</Text>
        <Text style={styles.subtitle}>{strings.login.subtitle}</Text>
      </View>

      <Controller
        control={control}
        name="companyCode"
        render={({ field, fieldState }) => (
          <TextField
            label={strings.login.companyCode}
            autoCapitalize="characters"
            autoCorrect={false}
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="identifier"
        render={({ field, fieldState }) => (
          <TextField
            label={strings.login.identifier}
            autoCapitalize="none"
            autoCorrect={false}
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label={strings.login.password}
            secureTextEntry
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />

      {formError ? (
        <Text style={styles.formError} accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}

      <Button
        title={isSubmitting ? strings.login.submitting : strings.login.submit}
        loading={isSubmitting}
        onPress={() => handleSubmit(onSubmit)()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#6B7280",
    marginTop: 4,
  },
  formError: {
    color: "#DC2626",
    marginBottom: 16,
    fontSize: 14,
  },
});
