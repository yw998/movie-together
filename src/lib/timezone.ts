import { NEW_YORK_TIMEZONE } from "../types/schedule";

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function parseLocalDateTime(localDate: string, localTime: string): LocalDateTime {
  const dateMatch = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = localTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) {
    throw new Error(`Invalid local date/time: ${localDate} ${localTime}`);
  }

  const value = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const check = new Date(
    Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute),
  );
  if (
    check.getUTCFullYear() !== value.year ||
    check.getUTCMonth() + 1 !== value.month ||
    check.getUTCDate() !== value.day
  ) {
    throw new Error(`Invalid local date/time: ${localDate} ${localTime}`);
  }
  return value;
}

export function localPartsAtInstant(
  instant: Date,
  timeZone = NEW_YORK_TIMEZONE,
): LocalDateTime {
  const values: Record<string, number> = {};
  for (const part of getFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function sameLocalDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function zonedLocalDateTimeToIso(
  localDate: string,
  localTime: string,
  timeZone = NEW_YORK_TIMEZONE,
): string {
  const target = parseLocalDateTime(localDate, localTime);
  const localAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );
  const matches: Array<{ instant: number; offsetMinutes: number }> = [];

  // Valid civil offsets range from UTC-12 through UTC+14. Searching in
  // 15-minute steps also covers the non-hour offsets used by IANA zones.
  for (let offsetMinutes = -12 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const instant = localAsUtc - offsetMinutes * 60_000;
    if (sameLocalDateTime(localPartsAtInstant(new Date(instant), timeZone), target)) {
      matches.push({ instant, offsetMinutes });
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `Nonexistent local time in ${timeZone}: ${localDate} ${localTime}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous local time in ${timeZone}: ${localDate} ${localTime}`);
  }

  return `${localDate}T${localTime}:00${formatOffset(matches[0].offsetMinutes)}`;
}
