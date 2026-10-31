import { useNavigate } from "react-router-dom";
import type { EmployeeDto, LeaveRequestDto, LeaveTypeDto } from "@employee-saas/shared";
import { StatusBadge } from "./StatusBadge";
import { useCompany } from "../lib/companyContext";
import { formatDate } from "../lib/formatDate";

export function LeaveRequestsTable({
  requests,
  leaveTypes,
  employees,
  showEmployee = true,
}: {
  requests: LeaveRequestDto[];
  leaveTypes: LeaveTypeDto[];
  employees?: EmployeeDto[];
  showEmployee?: boolean;
}) {
  const navigate = useNavigate();
  const { timezone } = useCompany();
  const leaveTypeNameById = new Map(leaveTypes.map((lt) => [lt.id, lt.name]));
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
          {showEmployee ? <th className="py-2">Employee</th> : null}
          <th className="py-2">Leave type</th>
          <th className="py-2">Dates</th>
          <th className="py-2">Days</th>
          <th className="py-2">Status</th>
          <th className="py-2">Proof</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => {
          const employee = employeeById.get(request.employeeId);
          return (
            <tr
              key={request.id}
              className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
              onClick={() => navigate(`/leave-requests/${request.id}`)}
            >
              {showEmployee ? (
                <td className="py-2.5 text-slate-900">
                  {employee ? `${employee.firstName} ${employee.lastName}` : request.employeeId}
                </td>
              ) : null}
              <td className="py-2.5 text-slate-900">{leaveTypeNameById.get(request.leaveTypeId) ?? "-"}</td>
              <td className="py-2.5 text-slate-600">
                {formatDate(request.startDate, timezone)} - {formatDate(request.endDate, timezone)}
              </td>
              <td className="py-2.5 text-slate-600">{request.totalDays}</td>
              <td className="py-2.5">
                <StatusBadge status={request.status} />
              </td>
              <td className="py-2.5">
                {request.proofStatus === "NOT_REQUIRED" ? "-" : <StatusBadge status={request.proofStatus} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
