export type CalendarWeek = { start: string; end: string };

function parseCalendarDate(localDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error(`Invalid calendar date: ${localDate}`);
  }
  const date = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) {
    throw new Error(`Invalid calendar date: ${localDate}`);
  }
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the Monday–Sunday calendar week containing a New York local date. */
export function calendarWeekFor(localDate: string): CalendarWeek {
  const anchor = parseCalendarDate(localDate);
  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  const start = new Date(anchor);
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: isoDate(start), end: isoDate(end) };
}
