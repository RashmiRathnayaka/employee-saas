import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  AttendanceAdminListQuerySchema,
  AttendanceStatusSchema,
  formatDuration,
  formatTime,
  todayInTimezone,
  type AttendanceListRowDto,
  type PaginatedResponse,
} from "@employee-saas/shared";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { CreateAttendanceDialog } from "../components/AttendanceDialogs";
import { AttendanceFlags } from "../components/AttendanceFlags";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Pagination } from "../components/Pagination";
import { StatusBadge } from "../components/StatusBadge";
import { api, ApiClientError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { useDepartments } from "../lib/queries";
import { strings } from "../strings";

const PAGE_SIZE = 50;
const ALL = "all";

/** One day's attendance. A manager sees their team, and HR and Company Admin see the
 * whole company: the API decides, and this only picks the endpoint. */
export function AttendancePage() {
  const { user } = useAuth();
  const { timezone } = useCompany();
  const navigate = useNavigate();
  const isManager = user?.role === "MANAGER";
  const canCorrect = user?.role === "HR" || user?.role === "COMPANY_ADMIN";
  const endpoint = isManager ? "/attendance/team" : "/attendance";

  // Empty until someone picks a date, so "today" follows the company's timezone once
  // it has loaded, rather than freezing whatever the default was on the first render.
  const [pickedDate, setPickedDate] = useState("");
  const date = pickedDate || todayInTimezone(timezone);
  const [status, setStatus] = useState(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const departments = useDepartments();

  const parsed = AttendanceAdminListQuerySchema.safeParse({ date });
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), date });
  if (status !== ALL) params.set("status", status);
  if (departmentId !== ALL) params.set("departmentId", departmentId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["attendance", endpoint, { page, date, status, departmentId }],
    queryFn: () => api.get<PaginatedResponse<AttendanceListRowDto>>(`${endpoint}?${params.toString()}`),
    enabled: !!user && parsed.success,
  });

  if (error instanceof ApiClientError && error.code === "MODULE_DISABLED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{strings.attendance.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title={strings.attendance.moduleOff} description={strings.attendance.moduleOffHint} />
        </CardContent>
      </Card>
    );
  }

  const filtering = status !== ALL || departmentId !== ALL;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{isManager ? strings.attendance.teamTitle : strings.attendance.title}</CardTitle>
        {canCorrect ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            {strings.attendance.addRecord}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="attendance-date">{strings.attendance.date}</Label>
            <Input
              id="attendance-date"
              type="date"
              className="w-44"
              value={date}
              onChange={(e) => {
                setPickedDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44" aria-label={strings.attendance.status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{strings.attendance.allStatuses}</SelectItem>
              {AttendanceStatusSchema.options.map((value) => (
                <SelectItem key={value} value={value}>
                  {strings.attendance.statuses[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canCorrect ? (
            <Select
              value={departmentId}
              onValueChange={(value) => {
                setDepartmentId(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-52" aria-label={strings.table.department}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{strings.attendance.allDepartments}</SelectItem>
                {departments.data?.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          filtering ? (
            <EmptyState title={strings.attendance.noMatches} />
          ) : (
            <EmptyState title={strings.attendance.noRecords} description={strings.attendance.noRecordsHint} />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-4">{strings.attendance.employee}</th>
                    <th className="py-2 pr-4">{strings.attendance.status}</th>
                    <th className="py-2 pr-4">{strings.attendance.schedule}</th>
                    <th className="py-2 pr-4">{strings.attendance.checkIn}</th>
                    <th className="py-2 pr-4">{strings.attendance.checkOut}</th>
                    <th className="py-2 pr-4">{strings.attendance.worked}</th>
                    <th className="py-2 pr-4">{strings.attendance.office}</th>
                    <th className="py-2 pr-4">{strings.attendance.flagsTitle}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900">{row.employeeName}</p>
                        <p className="text-xs text-slate-500">
                          {row.employeeCode}
                          {row.departmentName ? `, ${row.departmentName}` : ""}
                        </p>
                        {row.isCorrected ? <p className="mt-1 text-xs font-medium text-amber-700">{strings.attendance.corrected}</p> : null}
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={row.status} />
                        {row.lateMinutes > 0 ? <p className="mt-1 text-xs text-slate-500">{formatDuration(row.lateMinutes)}</p> : null}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">
                        {row.scheduledStartAt && row.scheduledEndAt
                          ? `${formatTime(row.scheduledStartAt, timezone)} - ${formatTime(row.scheduledEndAt, timezone)}`
                          : "-"}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{row.checkInAt ? formatTime(row.checkInAt, timezone) : "-"}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{row.checkOutAt ? formatTime(row.checkOutAt, timezone) : "-"}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{row.workedMinutes !== null ? formatDuration(row.workedMinutes) : "-"}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{row.siteName ?? "-"}</td>
                      <td className="py-2.5 pr-4">
                        <AttendanceFlags flags={row.flags} siteVisitFlags={row.siteVisitFlags} />
                      </td>
                      <td className="py-2.5 text-right">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-label={`${strings.attendance.details}: ${row.employeeName}`}
                          onClick={() => navigate(`/attendance/${row.id}`)}
                        >
                          {strings.attendance.details}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}

        {creating ? <CreateAttendanceDialog defaultDate={date} onClose={() => setCreating(false)} /> : null}
      </CardContent>
    </Card>
  );
}
