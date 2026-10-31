import { NavLink, Outlet } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, User } from "lucide-react";
import { useAuth } from "../lib/authContext";
import { useCompany } from "../lib/companyContext";
import { NAV_ITEMS } from "../lib/navigation";
import { cn } from "../lib/cn";
import { strings } from "../strings";

export function AppShell() {
  const { user, logout } = useAuth();
  const { company } = useCompany();

  if (!user) return null;

  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const displayName = user.email ?? strings.appName;
  const companyName = company?.name ?? (user.role === "SUPER_ADMIN" ? "Platform" : strings.appName);

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
          ) : (
            <div
              className="h-7 w-7 rounded bg-[var(--color-primary)]"
              aria-hidden
            />
          )}
          <span className="truncate text-sm font-semibold text-slate-900">{companyName}</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100",
                  isActive && "bg-slate-100 text-[var(--color-primary)]",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <span className="text-sm font-medium text-slate-500">{user.role.replace("_", " ")}</span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                <User className="h-4 w-4" aria-hidden />
                <span className="max-w-[180px] truncate">{displayName}</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-50 min-w-[160px] rounded-md border border-slate-200 bg-white p-1 shadow-md"
              >
                <DropdownMenu.Item
                  onSelect={() => logout()}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-slate-700 outline-none hover:bg-slate-100"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  {strings.common.logout}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>

        <main className="flex-1 bg-slate-50 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
