export type TimeCluster = "morning" | "afternoon" | "evening" | "lateNight";

export function parseDisplayTime(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/);
  if (!match) throw new Error(`Invalid display time: ${value}`);

  let hour = Number(match[1]) % 12;
  if (match[3] === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function minutesSinceMidnight(localTime: string): number {
  const match = localTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`Invalid local time: ${localTime}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatDisplayTime(localTime: string): string {
  const minutes = minutesSinceMidnight(localTime);
  const hour24 = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, "0");
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

export function getTimeCluster(localTime: string): TimeCluster {
  const minutes = minutesSinceMidnight(localTime);
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  if (minutes < 21 * 60) return "evening";
  return "lateNight";
}

export function newYorkLocalDate(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function defaultScheduleDate(
  availableDates: string[],
  fallbackDate: string,
  now = Date.now(),
): string {
  const today = newYorkLocalDate(now);
  if (availableDates.includes(today)) return today;
  return availableDates.find((date) => date > today)
    ?? availableDates.at(-1)
    ?? fallbackDate;
}

export function hasShowingStarted(startsAt: string, now = Date.now()): boolean {
  const start = Date.parse(startsAt);
  return Number.isFinite(start) && start <= now;
}
