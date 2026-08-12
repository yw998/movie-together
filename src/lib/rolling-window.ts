import { calendarWeekFor } from "./calendar-week";

export type RollingWindow = {
  start: string;
  end: string;
  weekStarts: string[];
};

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

