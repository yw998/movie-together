import { calendarWeekFor } from "./calendar-week";

export type RollingWindow = {
  start: string;
  end: string;
  weekStarts: string[];
};

export function datesForWindow(start: string, end: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime()) || start > end) {
    throw new Error(`Invalid calendar window: ${start}–${end}`);
  }
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    result.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function addCalendarDays(localDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error(`Invalid calendar date: ${localDate}`);
  const value = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== localDate) {
    throw new Error(`Invalid calendar date: ${localDate}`);
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function rollingWindowFor(anchor: string): RollingWindow {
  const end = addCalendarDays(anchor, 6);
  return {
    start: anchor,
    end,
    weekStarts: [...new Set([calendarWeekFor(anchor).start, calendarWeekFor(end).start])],
  };
}
