import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { ToastProvider } from "./lib/toast";
import { AuthProvider } from "./lib/authContext";
import { CompanyProvider } from "./lib/companyContext";
import { RequireAuth } from "./layout/RouteGuard";
import { AppShell } from "./layout/AppShell";
import { LoginPage } from "./routes/LoginPage";
import { PlatformLoginPage } from "./routes/PlatformLoginPage";
import { ChangePasswordPage } from "./routes/ChangePasswordPage";
import { DashboardPage } from "./routes/DashboardPage";
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
