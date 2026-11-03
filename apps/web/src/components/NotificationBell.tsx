import { useState } from "react";
import { Link } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell } from "lucide-react";
import { formatUnreadBadge } from "@employee-saas/shared";
import { NotificationItem } from "./NotificationItem";
import { useMarkAllNotificationsRead, useNotifications, useUnreadNotificationCount } from "../lib/notifications";
import { useOpenNotification } from "../lib/useOpenNotification";
import { strings } from "../strings";

const LATEST_COUNT = 5;

/** Top-bar bell: an unread badge, and a dropdown with the latest few
 * notifications. The list only loads while the dropdown is open. The count
 * polls on its own (see useUnreadNotificationCount). */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const countQuery = useUnreadNotificationCount();
  const listQuery = useNotifications({ page: 1, pageSize: LATEST_COUNT, unreadOnly: false, enabled: open });
  const markAll = useMarkAllNotificationsRead();
  const openNotification = useOpenNotification();

  const count = countQuery.data ?? 0;
  const badge = formatUnreadBadge(count);
  const label = count > 0 ? strings.notifications.bellLabelUnread(count) : strings.notifications.bellLabel;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {badge ? (
            <span
              data-testid="notification-badge"
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white"
            >
              {badge}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-96 rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-900">{strings.notifications.title}</span>
            <button
              type="button"
              className="text-xs font-medium text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              disabled={count === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              {strings.notifications.markAllRead}
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {listQuery.isLoading ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{strings.common.loading}</p>
            ) : listQuery.isError ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-red-700">{strings.notifications.loadError}</p>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-[var(--color-primary)] hover:underline"
                  onClick={() => listQuery.refetch()}
                >
                  {strings.common.retry}
                </button>
              </div>
            ) : (listQuery.data?.data.length ?? 0) === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{strings.notifications.empty}</p>
            ) : (
              listQuery.data!.data.map((n) => (
                <DropdownMenu.Item
                  key={n.id}
                  onSelect={() => openNotification(n)}
                  className="cursor-pointer border-b border-slate-100 px-4 py-3 outline-none last:border-b-0 hover:bg-slate-50 data-[highlighted]:bg-slate-50"
                >
                  <NotificationItem notification={n} compact />
                </DropdownMenu.Item>
              ))
            )}
          </div>

          <div className="border-t border-slate-200 px-4 py-2 text-center">
            <DropdownMenu.Item asChild>
              <Link to="/notifications" className="text-sm font-medium text-[var(--color-primary)] outline-none hover:underline">
                {strings.notifications.viewAll}
              </Link>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
