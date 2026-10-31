import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { PlatformLoginRequestSchema, type PlatformLoginRequest } from "@employee-saas/shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuth } from "../lib/authContext";
import { ApiClientError } from "../lib/apiClient";
import { strings } from "../strings";

export function PlatformLoginPage() {
  const { platformLogin } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PlatformLoginRequest>({
    resolver: zodResolver(PlatformLoginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(data: PlatformLoginRequest) {
    setFormError(null);
    try {
      await platformLogin(data.email, data.password);
      navigate("/", { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "NETWORK_ERROR") {
        setFormError(strings.errors.network);
      } else if (error instanceof ApiClientError && error.code === "RATE_LIMITED") {
        setFormError(strings.platformLogin.rateLimited);
      } else {
        setFormError(strings.platformLogin.genericError);
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800 p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-white">{strings.platformLogin.title}</h1>
        <p className="mt-1 text-sm text-slate-400">{strings.platformLogin.subtitle}</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-slate-200">
              {strings.platformLogin.email}
            </Label>
            <Input id="email" type="email" autoComplete="username" {...register("email")} />
            {errors.email ? <p className="text-sm text-red-400">{errors.email.message}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-slate-200">
              {strings.platformLogin.password}
            </Label>
            <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
            {errors.password ? <p className="text-sm text-red-400">{errors.password.message}</p> : null}
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-red-400">
              {formError}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? strings.platformLogin.submitting : strings.platformLogin.submit}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          <Link to="/login" className="hover:underline">
            {strings.platformLogin.backLink}
          </Link>
        </p>
      </div>
    </div>
  );
}
