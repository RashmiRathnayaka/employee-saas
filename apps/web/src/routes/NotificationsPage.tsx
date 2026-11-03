import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Skeleton } from "../components/ui/skeleton";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Pagination } from "../components/Pagination";
import { NotificationItem } from "../components/NotificationItem";
import { useMarkAllNotificationsRead, useNotifications, useUnreadNotificationCount } from "../lib/notifications";
import { useOpenNotification } from "../lib/useOpenNotification";
import { strings } from "../strings";

const PAGE_SIZE = 20;

export function NotificationsPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const listQuery = useNotifications({ page, pageSize: PAGE_SIZE, unreadOnly: filter === "unread" });
  const countQuery = useUnreadNotificationCount();
  const markAll = useMarkAllNotificationsRead();
  const openNotification = useOpenNotification();

  const unreadCount = countQuery.data ?? 0;
  const rows = listQuery.data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>{strings.notifications.title}</CardTitle>
        <Button
          variant="secondary"
          size="sm"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          {strings.notifications.markAllRead}
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs
          value={filter}
          onValueChange={(v) => {
            setFilter(v as "all" | "unread");
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">{strings.notifications.filterAll}</TabsTrigger>
            <TabsTrigger value="unread">{strings.notifications.filterUnread(unreadCount)}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4">
          {listQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : listQuery.isError ? (
            <ErrorState message={strings.notifications.loadError} onRetry={() => listQuery.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title={filter === "unread" ? strings.notifications.emptyUnread : strings.notifications.empty} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white">
              <ul className="divide-y divide-slate-100">
                {rows.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className="w-full px-4 py-3 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                    >
                      <NotificationItem notification={n} />
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={listQuery.data?.total ?? 0}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
