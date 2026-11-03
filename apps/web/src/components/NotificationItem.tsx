import { formatDateTime, type NotificationDto } from "@employee-saas/shared";
import { useCompany } from "../lib/companyContext";
import { cn } from "../lib/cn";
import { strings } from "../strings";

/** One notification row. Shared by the bell dropdown and the full page.
 * Unread rows get a dot and bold title. The time is shown in the
 * company's timezone. */
export function NotificationItem({ notification, compact = false }: { notification: NotificationDto; compact?: boolean }) {
  const { timezone } = useCompany();
  const unread = notification.readAt === null;

  return (
    <div className="flex w-full items-start gap-3 text-left">
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", unread ? "bg-[var(--color-primary)]" : "bg-transparent")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm text-slate-900", unread ? "font-semibold" : "font-normal")}>
          {notification.title}
          {unread ? <span className="sr-only"> ({strings.notifications.unread})</span> : null}
        </p>
        <p className={cn("text-sm text-slate-600", compact && "line-clamp-2")}>{notification.body}</p>
        <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(notification.createdAt, timezone)}</p>
      </div>
    </div>
  );
}
