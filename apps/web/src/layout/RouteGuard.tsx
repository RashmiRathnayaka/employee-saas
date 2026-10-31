import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Role } from "@employee-saas/shared";
import { useAuth } from "../lib/authContext";
import { strings } from "../strings";

export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        {strings.common.loading}
      </div>
    );
  }

  if (status === "unauthenticated" || !user) {
    const isPlatformPath = location.pathname.startsWith("/platform");
    return <Navigate to={isPlatformPath ? "/platform/login" : "/login"} state={{ from: location.pathname }} replace />;
  }

  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/not-allowed" replace />;
  }

  return <Outlet />;
}
