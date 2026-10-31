import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { ChangePasswordRequestSchema, type ChangePasswordRequest } from "@employee-saas/shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { api } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { applyApiErrorToForm, getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

export function ChangePasswordPage() {
  const { refreshMe } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(ChangePasswordRequestSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  async function onSubmit(data: ChangePasswordRequest) {
    try {
      await api.post("/auth/change-password", data);
      await refreshMe();
      toast.success(strings.changePassword.success);
      navigate("/", { replace: true });
    } catch (error) {
      if (!applyApiErrorToForm(error, setError)) {
        toast.error(getErrorMessage(error));
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{strings.changePassword.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{strings.changePassword.subtitle}</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">{strings.changePassword.currentPassword}</Label>
            <Input id="currentPassword" type="password" autoComplete="current-password" {...register("currentPassword")} />
            {errors.currentPassword ? <p className="text-sm text-red-600">{errors.currentPassword.message}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">{strings.changePassword.newPassword}</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" {...register("newPassword")} />
            {errors.newPassword ? <p className="text-sm text-red-600">{errors.newPassword.message}</p> : null}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? strings.changePassword.submitting : strings.changePassword.submit}
          </Button>
        </form>
      </div>
    </div>
  );
}
