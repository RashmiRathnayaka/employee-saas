import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import type { EmployeeDto, PaginatedResponse } from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";
import { api } from "../lib/apiClient";
import { useDepartments } from "../lib/queries";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { strings } from "../strings";

const PAGE_SIZE = 20;

export function EmployeesListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebouncedValue(search);
  const { data: departments } = useDepartments();

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (departmentId !== "all") params.set("departmentId", departmentId);
  if (status !== "all") params.set("status", status);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["employees", { page, debouncedSearch, departmentId, status }],
    queryFn: () => api.get<PaginatedResponse<EmployeeDto>>(`/employees?${params.toString()}`),
  });

  const departmentNameById = new Map((departments ?? []).map((d) => [d.id, d.name]));

  function resetToFirstPage() {
    setPage(1);
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{strings.employees.title}</CardTitle>
        <Button asChild size="sm">
          <Link to="/employees/new">
            <Plus className="h-4 w-4" aria-hidden />
            {strings.employees.newEmployee}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input
            placeholder={strings.table.search}
            className="max-w-xs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetToFirstPage();
            }}
          />
          <Select
            value={departmentId}
            onValueChange={(value) => {
              setDepartmentId(value);
              resetToFirstPage();
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{strings.table.allDepartments}</SelectItem>
              {(departments ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              resetToFirstPage();
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{strings.table.allStatuses}</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title={strings.employees.noEmployees} description={strings.employees.noEmployeesHint} />
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2">{strings.employees.employeeCode}</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">{strings.employees.department}</th>
                  <th className="py-2">{strings.table.status}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((employee) => (
                  <tr
                    key={employee.id}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                    onClick={() => navigate(`/employees/${employee.id}`)}
                  >
                    <td className="py-2.5 text-slate-500">{employee.employeeCode}</td>
                    <td className="py-2.5 font-medium text-slate-900">
                      {employee.firstName} {employee.lastName}
                    </td>
                    <td className="py-2.5 text-slate-600">
                      {employee.departmentId ? departmentNameById.get(employee.departmentId) ?? "-" : "-"}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={employee.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
