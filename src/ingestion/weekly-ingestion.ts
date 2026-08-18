import { calendarWeekFor } from "../lib/calendar-week";
import { rollingWindowFor } from "../lib/rolling-window";
import { fetchFilmForumSchedule } from "./adapters/film-forum";
import { fetchIfcCenterSchedule } from "./adapters/ifc-center";
import { fetchMetrographSchedule } from "./adapters/metrograph";
import { fetchParisTheaterSchedule } from "./adapters/paris-theater";
import { fetchFilmAtLincolnCenterSchedule } from "./adapters/film-at-lincoln-center";
import { fetchRoxyCinemaSchedule } from "./adapters/roxy-cinema";
import { fetchSyndicatedSchedule } from "./adapters/syndicated";
import type { ReviewBundle } from "./review-report";
import type { AdapterResult } from "./types";

export type ScheduleIngestionBundle = ReviewBundle & {
  timezone: "America/New_York";
  windowKind: "calendar_week_monday_sunday" | "rolling_seven_days";
  windowStart: string;
  windowEnd: string;
};

/** @deprecated Calendar-week naming remains temporarily for artifact compatibility. */
export type WeeklyIngestionBundle = ScheduleIngestionBundle;

export type ScheduleFetcher = (windowStart: string, windowEnd: string) => Promise<AdapterResult>;

export const officialScheduleFetchers: ScheduleFetcher[] = [
  fetchFilmForumSchedule,
  fetchIfcCenterSchedule,
  fetchRoxyCinemaSchedule,
  fetchMetrographSchedule,
  fetchParisTheaterSchedule,
  fetchFilmAtLincolnCenterSchedule,
  fetchSyndicatedSchedule,
];

export async function fetchWeeklyIngestionBundle(
  anchorLocalDate: string,
  fetchers: ScheduleFetcher[] = officialScheduleFetchers,
): Promise<WeeklyIngestionBundle> {
  const window = calendarWeekFor(anchorLocalDate);
  const adapters = await Promise.all(
    fetchers.map((fetchSchedule) => fetchSchedule(window.start, window.end)),
  );
  return {
    generatedAt: new Date().toISOString(),
    timezone: "America/New_York",
    windowKind: "calendar_week_monday_sunday",
    windowStart: window.start,
    windowEnd: window.end,
    adapters,
  };
}

export async function fetchRollingIngestionBundle(
  anchorLocalDate: string,
  fetchers: ScheduleFetcher[] = officialScheduleFetchers,
): Promise<ScheduleIngestionBundle> {
  const window = rollingWindowFor(anchorLocalDate);
  const adapters = await Promise.all(
    fetchers.map((fetchSchedule) => fetchSchedule(window.start, window.end)),
  );
  return {
    generatedAt: new Date().toISOString(),
    timezone: "America/New_York",
    windowKind: "rolling_seven_days",
    windowStart: window.start,
    windowEnd: window.end,
    adapters,
  };
}
