import { useState } from "react";
import type { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { CreateEmployeeRequestSchema, type CreateEmployeeResponse } from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { TempPasswordDialog } from "../components/TempPasswordDialog";
import { api } from "../lib/apiClient";
import { useDepartments, useDesignations, useManagerOptions } from "../lib/queries";
import { applyApiErrorToForm, getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

// z.input (not z.infer/output) because the schema's `.default(...)` fields
// (createLogin, loginRole) are optional on the way *in* - that's the shape
// react-hook-form's resolver actually expects for defaultValues/register.
type CreateEmployeeFormValues = z.input<typeof CreateEmployeeRequestSchema>;

export function CreateEmployeePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: departments } = useDepartments();
  const { data: designations } = useDesignations();
  const { data: managers } = useManagerOptions();
  const [createdEmployeeId, setCreatedEmployeeId] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateEmployeeFormValues>({
    resolver: zodResolver(CreateEmployeeRequestSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      joiningDate: "",
      createLogin: false,
      loginEmail: "",
      loginRole: "EMPLOYEE",
    },
  });

  const createLogin = watch("createLogin");

  async function onSubmit(values: CreateEmployeeFormValues) {
    try {
      const payload = { ...values, phone: values.phone || undefined };
      const res = await api.post<CreateEmployeeResponse>("/employees", payload);
      if (res.login) {
        setCreatedEmployeeId(res.employee.id);
        setTemporaryPassword(res.login.temporaryPassword);
      } else {
        toast.success(strings.employees.createdTitle);
        navigate(`/employees/${res.employee.id}`);
      }
    } catch (error) {
      if (!applyApiErrorToForm(error, setError)) {
        toast.error(getErrorMessage(error));
      }
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{strings.employees.newEmployee}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">{strings.employees.firstName}</Label>
              <Input id="firstName" {...register("firstName")} />
              {errors.firstName ? <p className="text-sm text-red-600">{errors.firstName.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">{strings.employees.lastName}</Label>
              <Input id="lastName" {...register("lastName")} />
              {errors.lastName ? <p className="text-sm text-red-600">{errors.lastName.message}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">{strings.employees.phone}</Label>
              <Input id="phone" {...register("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="joiningDate">{strings.employees.joiningDate}</Label>
              <Input id="joiningDate" type="date" {...register("joiningDate")} />
              {errors.joiningDate ? <p className="text-sm text-red-600">{errors.joiningDate.message}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>{strings.employees.department}</Label>
              <Controller
                control={control}
                name="departmentId"
                render={({ field }) => (
                  <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? undefined : v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{strings.employees.none}</SelectItem>
                      {(departments ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{strings.employees.designation}</Label>
              <Controller
                control={control}
                name="designationId"
                render={({ field }) => (
                  <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? undefined : v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{strings.employees.none}</SelectItem>
                      {(designations ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{strings.employees.manager}</Label>
              <Controller
                control={control}
                name="managerId"
                render={({ field }) => (
                  <Select value={field.value ?? "none"} onValueChange={(v) => field.onChange(v === "none" ? undefined : v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{strings.employees.none}</SelectItem>
                      {(managers ?? []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.firstName} {m.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Controller
              control={control}
              name="createLogin"
              render={({ field }) => (
                <Checkbox id="createLogin" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="createLogin">{strings.employees.createLogin}</Label>
          </div>

          {createLogin ? (
            <div className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="loginEmail">{strings.employees.loginEmail}</Label>
                <Input id="loginEmail" type="email" {...register("loginEmail")} />
                {errors.loginEmail ? <p className="text-sm text-red-600">{errors.loginEmail.message}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label>{strings.employees.loginRole}</Label>
                <Controller
                  control={control}
                  name="loginRole"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EMPLOYEE">EMPLOYEE</SelectItem>
                        <SelectItem value="MANAGER">MANAGER</SelectItem>
                        <SelectItem value="HR">HR</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => navigate("/employees")}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? strings.employees.creating : strings.employees.create}
            </Button>
          </div>
        </form>
      </CardContent>

      <TempPasswordDialog
        open={!!temporaryPassword}
        onOpenChange={(open) => {
          if (!open && createdEmployeeId) {
            navigate(`/employees/${createdEmployeeId}`);
          }
        }}
        password={temporaryPassword}
        title={strings.employees.createdTitle}
      />
    </Card>
  );
}
