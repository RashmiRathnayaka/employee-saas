import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LoginRequestSchema, type LoginRequest } from "@employee-saas/shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuth } from "../lib/authContext";
import { ApiClientError } from "../lib/apiClient";
import { strings } from "../strings";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { companyCode: "", identifier: "", password: "" },
  });

  async function onSubmit(data: LoginRequest) {
    setFormError(null);
    try {
      await login(data.companyCode, data.identifier, data.password);
      const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "NETWORK_ERROR") {
        setFormError(strings.errors.network);
      } else if (error instanceof ApiClientError && error.code === "RATE_LIMITED") {
        // Distinct from genericError - rate-limiting isn't a credentials
        // signal, so surfacing it doesn't leak which part was wrong, and
        // without this the user has no way to tell "wait a bit" apart from
        // "your password is wrong".
        setFormError(strings.login.rateLimited);
      } else {
        // Deliberately generic - never reveal which part (company code,
        // identifier, or password) was wrong.
        setFormError(strings.login.genericError);
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{strings.login.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{strings.login.subtitle}</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="companyCode">{strings.login.companyCode}</Label>
            <Input id="companyCode" autoComplete="organization" {...register("companyCode")} />
            {errors.companyCode ? <p className="text-sm text-red-600">{errors.companyCode.message}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="identifier">{strings.login.identifier}</Label>
            <Input id="identifier" autoComplete="username" {...register("identifier")} />
            {errors.identifier ? <p className="text-sm text-red-600">{errors.identifier.message}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{strings.login.password}</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
            {errors.password ? <p className="text-sm text-red-600">{errors.password.message}</p> : null}
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? strings.login.submitting : strings.login.submit}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          {strings.login.platformLinkPrompt}{" "}
          <Link to="/platform/login" className="text-[var(--color-primary)] hover:underline">
            {strings.login.platformLink}
          </Link>
        </p>
      </div>
    </div>
  );
}
