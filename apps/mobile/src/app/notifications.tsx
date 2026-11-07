import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { formatDateTime, getNotificationTarget, type NotificationDto } from "@employee-saas/shared";
import { Screen } from "../components/ui/Screen";
import { Button } from "../components/ui/Button";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { useAuth } from "../lib/authContext";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsList,
  useUnreadNotificationCount,
} from "../lib/notifications";
import { useCompanyTimezone, usePrimaryColor } from "../lib/theme";
import { strings } from "../strings";

export default function NotificationsScreen() {
  const { status } = useAuth();
  const listQuery = useNotificationsList();
  const countQuery = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const timezone = useCompanyTimezone();
  const primaryColor = usePrimaryColor();

  const rows = useMemo(() => listQuery.data?.pages.flatMap((p) => p.data) ?? [], [listQuery.data]);
  const unreadCount = countQuery.data ?? 0;

  // This screen sits outside (tabs), so it needs its own auth guard.
  if (status === "unauthenticated") return <Redirect href="/login" />;

  /** Tap: mark read (if unread), then open what it's about. The navigation doesn't
   * wait for the PATCH, so a slow network never blocks it. The phone has no screen for
   * one record or visit, so a correction or an auto-close opens the list it shows up in.
   * A manager's SITE_CHECKED_IN isn't about their own visits, so it opens nothing. */
  function openNotification(n: NotificationDto) {
    if (n.readAt === null) markRead.mutate(n.id);
    const target = getNotificationTarget(n);
    if (target?.kind === "leaveRequest") router.push(`/leave/${target.id}`);
    if (target?.kind === "attendance") router.push("/attendance");
    if (target?.kind === "siteVisit" && n.type !== "SITE_CHECKED_IN") router.push("/my-visits");
  }

  async function onRefresh() {
    await Promise.all([listQuery.refetch(), countQuery.refetch()]);
  }

  if (listQuery.isLoading) {
    return (
      <Screen padded={false}>
        <LoadingView />
      </Screen>
    );
  }

  if (listQuery.isError) {
    return (
      <Screen padded={false}>
        <ErrorView message={strings.notifications.loadError} onRetry={onRefresh} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.content}
        refreshControl={
          <RefreshControl refreshing={listQuery.isRefetching && !listQuery.isFetchingNextPage} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          rows.length > 0 ? (
            <View style={styles.header}>
              <Button
                title={strings.notifications.markAllRead}
                variant="secondary"
                disabled={unreadCount === 0}
                loading={markAll.isPending}
                onPress={() => markAll.mutate()}
              />
            </View>
          ) : undefined
        }
        ListEmptyComponent={<EmptyView message={strings.notifications.empty} />}
        onEndReached={() => {
          if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) listQuery.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={listQuery.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : undefined}
        renderItem={({ item }) => {
          const unread = item.readAt === null;
          return (
            <Pressable
              onPress={() => openNotification(item)}
              accessibilityRole="button"
              accessibilityLabel={unread ? `${item.title}, ${strings.notifications.unread}` : item.title}
              style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.rowPressed]}
            >
              <View style={[styles.dot, { backgroundColor: unread ? primaryColor : "transparent" }]} />
              <View style={styles.rowText}>
                <Text style={[styles.title, unread && styles.titleUnread]}>{item.title}</Text>
                <Text style={styles.body}>{item.body}</Text>
                <Text style={styles.time}>{formatDateTime(item.createdAt, timezone)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  emptyContent: { flexGrow: 1 },
  header: { padding: 16 },
  footer: { marginVertical: 16 },
  row: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  rowUnread: { backgroundColor: "#F9FAFB" },
  rowPressed: { opacity: 0.7 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 12 },
  rowText: { flex: 1 },
  title: { fontSize: 15, color: "#111827" },
  titleUnread: { fontWeight: "700" },
  body: { fontSize: 14, color: "#4B5563", marginTop: 2 },
  time: { fontSize: 12, color: "#9CA3AF", marginTop: 4 },
});
