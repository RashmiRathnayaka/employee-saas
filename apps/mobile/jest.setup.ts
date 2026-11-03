import { afterEach } from "@jest/globals";
import { queryClient } from "./src/lib/queryClient";

// Most screen tests render with the app's shared queryClient. By default
// React Query leaves a 5-minute cache clean-up timer (gcTime) behind for
// every query and mutation, and Jest won't exit while timers are pending.
// A single test file then took ~5 minutes, and the full suite printed "A
// worker process has failed to exit gracefully".
// Tests only: gcTime Infinity schedules no timer at all, and clear()
// stops one test's cached data leaking into the next. The app's real
// defaults (lib/queryClient.ts) are unchanged.
const defaults = queryClient.getDefaultOptions();
queryClient.setDefaultOptions({
  ...defaults,
  queries: { ...defaults.queries, gcTime: Infinity },
  mutations: { ...defaults.mutations, gcTime: Infinity },
});

afterEach(() => {
  queryClient.clear();
});
