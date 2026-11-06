import { useQuery } from "@tanstack/react-query";
import { formatTime, todayInTimezone, type MyScheduleResponse, type ScheduleDayDto } from "@employee-saas/shared";
import { api } from "./apiClient";
import { strings } from "../strings";

export function useMySchedule(enabled: boolean) {
  return useQuery({
    queryKey: ["schedule", "me"],
    queryFn: () => api.get<MyScheduleResponse>("/schedule/me"),
    enabled,
  });
}

/** One day of the schedule in words, in company time. */
export function scheduleDayText(day: ScheduleDayDto, timezone: string): string {
  if (day.dayType === "OFF") return strings.schedule.dayOff;
  if (day.dayType === "HOLIDAY") return strings.schedule.holiday;
  if (day.dayType === "ON_LEAVE") return strings.schedule.onLeave;

  const start = day.scheduledStartAt!;
  const end = day.scheduledEndAt!;
  const crossesMidnight = todayInTimezone(timezone, new Date(end)) !== day.date;
  const times = `${formatTime(start, timezone)} - ${formatTime(end, timezone)}${crossesMidnight ? ` (${strings.schedule.nextDay})` : ""}`;

  if (day.isHalfDayLeave) return `${times} · ${strings.schedule.halfDayLeave}`;
  return day.dayType === "HALF" ? `${times} · ${strings.schedule.halfDay}` : times;
}
