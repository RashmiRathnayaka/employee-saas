import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./lib/toast";
import { AuthProvider } from "./lib/authContext";
import { CompanyProvider } from "./lib/companyContext";
import { RequireAuth, RequireRole } from "./layout/RouteGuard";
import { AppShell } from "./layout/AppShell";
import { LoginPage } from "./routes/LoginPage";
import { PlatformLoginPage } from "./routes/PlatformLoginPage";
import { ChangePasswordPage } from "./routes/ChangePasswordPage";
import { DashboardPage } from "./routes/DashboardPage";
import { EmployeesListPage } from "./routes/EmployeesListPage";
import { CreateEmployeePage } from "./routes/CreateEmployeePage";
import { EmployeeDetailPage } from "./routes/EmployeeDetailPage";
import { DepartmentsPage } from "./routes/DepartmentsPage";
import { DesignationsPage } from "./routes/DesignationsPage";
import { UsersPage } from "./routes/UsersPage";
import { LeaveTypesPage } from "./routes/LeaveTypesPage";
import { HolidaysPage } from "./routes/HolidaysPage";
import { HrLeaveRequestsPage } from "./routes/HrLeaveRequestsPage";
import { TeamLeaveRequestsPage } from "./routes/TeamLeaveRequestsPage";
import { MyLeavePage } from "./routes/MyLeavePage";
import { LeaveRequestDetailPage } from "./routes/LeaveRequestDetailPage";
import { CompanySettingsPage } from "./routes/CompanySettingsPage";
import { CompaniesPage } from "./routes/CompaniesPage";
import { NotAllowedPage } from "./routes/NotAllowedPage";
import { NotFoundPage } from "./routes/NotFoundPage";

export function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <CompanyProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/platform/login" element={<PlatformLoginPage />} />
                <Route element={<RequireAuth />}>
                  <Route path="/change-password" element={<ChangePasswordPage />} />
                  <Route path="/not-allowed" element={<NotAllowedPage />} />
                  <Route element={<AppShell />}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route element={<RequireRole roles={["COMPANY_ADMIN", "HR", "MANAGER"]} />}>
                      <Route path="/employees" element={<EmployeesListPage />} />
                      <Route path="/employees/:id" element={<EmployeeDetailPage />} />
                    </Route>
                    <Route element={<RequireRole roles={["COMPANY_ADMIN", "HR"]} />}>
                      <Route path="/employees/new" element={<CreateEmployeePage />} />
                      <Route path="/departments" element={<DepartmentsPage />} />
                      <Route path="/designations" element={<DesignationsPage />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/leave-requests" element={<HrLeaveRequestsPage />} />
                      <Route path="/leave-types" element={<LeaveTypesPage />} />
                      <Route path="/holidays" element={<HolidaysPage />} />
                    </Route>
                    <Route element={<RequireRole roles={["MANAGER"]} />}>
                      <Route path="/leave-requests/team" element={<TeamLeaveRequestsPage />} />
                    </Route>
                    <Route element={<RequireRole roles={["COMPANY_ADMIN", "HR", "MANAGER", "EMPLOYEE"]} />}>
                      <Route path="/my-leave" element={<MyLeavePage />} />
                      <Route path="/leave-requests/:id" element={<LeaveRequestDetailPage />} />
                    </Route>
                    <Route element={<RequireRole roles={["COMPANY_ADMIN"]} />}>
                      <Route path="/settings" element={<CompanySettingsPage />} />
                    </Route>
                    <Route element={<RequireRole roles={["SUPER_ADMIN"]} />}>
                      <Route path="/companies" element={<CompaniesPage />} />
                    </Route>
                  </Route>
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </CompanyProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
