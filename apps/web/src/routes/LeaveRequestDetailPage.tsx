import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import type {
  EmployeeDto,
  LeaveApprovalDto,
  LeaveBalanceDto,
  LeaveDocumentDto,
  LeaveRequestDto,
  LeaveTypeDto,
} from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { ErrorState } from "../components/ErrorState";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { api } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { formatDate } from "../lib/formatDate";
import { canDecideLeaveRequest } from "../lib/leaveDecisionRules";
import { getErrorMessage } from "../lib/errorMapping";
import { useToast } from "../lib/toast";
import { strings } from "../strings";

export function LeaveRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requestId = id!;
  const { user } = useAuth();
  const { timezone } = useCompany();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [note, setNote] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detailQuery = useQuery({
    queryKey: ["leave-request", requestId],
    queryFn: () => api.get<{ leaveRequest: LeaveRequestDto; approvals: LeaveApprovalDto[] }>(`/leave-requests/${requestId}`),
  });

  const leaveTypesQuery = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => api.get<{ data: LeaveTypeDto[] }>("/leave-types"),
    staleTime: 60 * 1000,
  });

  const employeeId = detailQuery.data?.leaveRequest.employeeId;
  const employeeQuery = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => api.get<{ employee: EmployeeDto }>(`/employees/${employeeId}`),
    enabled: !!employeeId,
  });

  const canSeeDocuments = user?.role !== "MANAGER";
  const documentsQuery = useQuery({
    queryKey: ["leave-request", requestId, "documents"],
    queryFn: () => api.get<{ data: LeaveDocumentDto[] }>(`/leave-requests/${requestId}/documents`),
    enabled: canSeeDocuments,
  });

  const balancesQuery = useQuery({
    queryKey: ["employee", employeeId, "leave-balances"],
    queryFn: () => api.get<{ data: LeaveBalanceDto[] }>(`/employees/${employeeId}/leave-balances`),
    enabled: !!employeeId,
  });

  function invalidateAll() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["leave-request", requestId] }),
      queryClient.invalidateQueries({ queryKey: ["employee", employeeId, "leave-balances"] }),
    ]);
  }

  const decideMutation = useMutation({
    mutationFn: ({ decision }: { decision: "approve" | "reject" }) =>
      api.patch(`/leave-requests/${requestId}/${decision}`, { note: note || undefined }),
    onSuccess: async (_data, variables) => {
      await invalidateAll();
      setNote("");
      toast.success(variables.decision === "approve" ? strings.leaveRequests.approveSuccess : strings.leaveRequests.rejectSuccess);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.patch(`/leave-requests/${requestId}/revoke`, { note: note || undefined }),
    onSuccess: async () => {
      await invalidateAll();
      setNote("");
      setRevokeOpen(false);
      toast.success(strings.leaveRequests.revokeSuccess);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      setRevokeOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.patch(`/leave-requests/${requestId}/cancel`),
    onSuccess: async () => {
      await invalidateAll();
      setCancelOpen(false);
      toast.success(strings.leaveRequests.cancelSuccess);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
      setCancelOpen(false);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.upload(`/leave-requests/${requestId}/documents`, formData);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leave-request", requestId, "documents"] });
      await queryClient.invalidateQueries({ queryKey: ["leave-request", requestId] });
      toast.success(strings.common.save);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ docId, status, note: reviewNote }: { docId: string; status: "ACCEPTED" | "REJECTED" | "INFO_REQUIRED"; note?: string }) =>
      api.patch(`/leave-requests/${requestId}/documents/${docId}/review`, { status, note: reviewNote }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leave-request", requestId, "documents"] });
      await queryClient.invalidateQueries({ queryKey: ["leave-request", requestId] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  async function handleDownload(docId: string) {
    try {
      const res = await api.get<{ url: string }>(`/leave-requests/${requestId}/documents/${docId}/download`);
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  if (detailQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <ErrorState message={strings.common.somethingWentWrong} onRetry={() => detailQuery.refetch()} />;
  }

  const { leaveRequest, approvals } = detailQuery.data;
  const leaveTypeName = leaveTypesQuery.data?.data.find((lt) => lt.id === leaveRequest.leaveTypeId)?.name ?? "-";
  const employee = employeeQuery.data?.employee;
  const balance = balancesQuery.data?.data.find((b) => b.leaveTypeId === leaveRequest.leaveTypeId);
  const canDecide = canDecideLeaveRequest(leaveRequest, user);
  const isOwner = user?.employeeId === leaveRequest.employeeId;
  const canRevoke = (user?.role === "COMPANY_ADMIN" || user?.role === "HR") && leaveRequest.status === "APPROVED";
  const canCancel = isOwner && (leaveRequest.status === "PENDING_MANAGER" || leaveRequest.status === "PENDING_HR");
  const isPending = leaveRequest.status === "PENDING_MANAGER" || leaveRequest.status === "PENDING_HR";
  const canUploadDoc = isOwner && leaveRequest.proofStatus !== "NOT_REQUIRED";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>
              {leaveTypeName} - {employee ? `${employee.firstName} ${employee.lastName}` : "..."}
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {formatDate(leaveRequest.startDate, timezone)} - {formatDate(leaveRequest.endDate, timezone)} (
              {leaveRequest.totalDays} {strings.leaveRequests.totalDays.toLowerCase()})
            </p>
          </div>
          <StatusBadge status={leaveRequest.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase text-slate-400">{strings.leaveRequests.halfDay}</dt>
              <dd className="mt-0.5 text-slate-900">
                {leaveRequest.startHalfDay || leaveRequest.endHalfDay ? "Yes" : "No"}
              </dd>
            </div>
            {balance ? (
              <>
                <div>
                  <dt className="text-xs uppercase text-slate-400">{strings.employees.available}</dt>
                  <dd className="mt-0.5 text-slate-900">{balance.availableDays}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-400">{strings.employees.used}</dt>
                  <dd className="mt-0.5 text-slate-900">
                    {balance.usedDays}
                    {isPending ? ` -> ${balance.usedDays + leaveRequest.totalDays} ${strings.leaveRequests.balanceAfter.toLowerCase()}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-400">{strings.employees.pending}</dt>
                  <dd className="mt-0.5 text-slate-900">{balance.pendingDays}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {leaveRequest.reason ? (
            <div>
              <dt className="text-xs uppercase text-slate-400">{strings.leaveRequests.reason}</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{leaveRequest.reason}</dd>
            </div>
          ) : null}

          {canDecide ? (
            <div className="space-y-2 rounded-md bg-slate-50 p-4">
              <textarea
                className="w-full rounded-md border border-slate-300 p-2 text-sm"
                rows={2}
                placeholder={strings.leaveRequests.decisionNotePlaceholder}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={() => decideMutation.mutate({ decision: "approve" })} disabled={decideMutation.isPending}>
                  {strings.leaveRequests.approve}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => decideMutation.mutate({ decision: "reject" })}
                  disabled={decideMutation.isPending}
                >
                  {strings.leaveRequests.reject}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2">
            {canCancel ? (
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                {strings.leaveRequests.cancel}
              </Button>
            ) : null}
            {canRevoke ? (
              <Button variant="destructive" onClick={() => setRevokeOpen(true)}>
                {strings.leaveRequests.revoke}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{strings.leaveRequests.approvalHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {approvals.length === 0 ? (
            <p className="text-sm text-slate-500">No decisions yet.</p>
          ) : (
            <ul className="space-y-3">
              {approvals.map((approval) => (
                <li key={approval.id} className="text-sm">
                  <span className="font-medium text-slate-900">
                    {approval.step} - {approval.decision}
                  </span>{" "}
                  <span className="text-slate-500">
                    by {approval.approver.email ?? approval.approver.id} on {formatDate(approval.decidedAt, timezone)}
                  </span>
                  {approval.note ? <p className="mt-0.5 text-slate-600">"{approval.note}"</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canSeeDocuments ? (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{strings.leaveRequests.documents}</CardTitle>
            {canUploadDoc ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadMutation.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  {strings.leaveRequests.uploadDocument}
                </Button>
              </>
            ) : null}
          </CardHeader>
          <CardContent>
            {!documentsQuery.data || documentsQuery.data.data.length === 0 ? (
              <p className="text-sm text-slate-500">{strings.leaveRequests.noDocuments}</p>
            ) : (
              <ul className="space-y-3">
                {documentsQuery.data.data.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{doc.filename}</p>
                      <p className="text-xs text-slate-500">{formatDate(doc.uploadedAt, timezone)}</p>
                      {doc.reviewNote ? <p className="mt-1 text-xs text-slate-600">"{doc.reviewNote}"</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={doc.status} />
                      <Button size="sm" variant="secondary" onClick={() => handleDownload(doc.id)}>
                        {strings.leaveRequests.download}
                      </Button>
                      {user?.role === "HR" ? (
                        <>
                          <Button size="sm" onClick={() => reviewMutation.mutate({ docId: doc.id, status: "ACCEPTED" })}>
                            {strings.leaveRequests.reviewAccept}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => reviewMutation.mutate({ docId: doc.id, status: "REJECTED" })}
                          >
                            {strings.leaveRequests.reviewReject}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => reviewMutation.mutate({ docId: doc.id, status: "INFO_REQUIRED" })}
                          >
                            {strings.leaveRequests.reviewInfoRequired}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Button variant="ghost" onClick={() => navigate(-1)}>
        &larr; Back
      </Button>

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={strings.leaveRequests.revoke}
        description={strings.leaveRequests.revokeConfirm}
        onConfirm={() => revokeMutation.mutateAsync()}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={strings.leaveRequests.cancel}
        description={strings.leaveRequests.cancelConfirm}
        onConfirm={() => cancelMutation.mutateAsync()}
      />
    </div>
  );
}
