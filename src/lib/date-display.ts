function parts(value: string): { year: number; month: number; day: number } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid calendar date: ${value}`);
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatWindowYears(start: string, end: string): string {
  const first = parts(start);
  const last = parts(end);
  return first.year === last.year ? String(first.year) : `${first.year}–${last.year}`;
}

export function formatWindowZh(start: string, end: string): string {
  const first = parts(start);
  const last = parts(end);
  if (first.year !== last.year) {
    return `${first.year} 年 ${first.month} 月 ${first.day} 日–${last.year} 年 ${last.month} 月 ${last.day} 日`;
  }
  if (first.month !== last.month) {
    return `${first.month} 月 ${first.day} 日–${last.month} 月 ${last.day} 日`;
  }
  return `${first.month} 月 ${first.day}–${last.day} 日`;
}

export function formatCalendarDate(localDate: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) {
    throw new Error(`Invalid calendar date: ${localDate}`);
  }
  return new Intl.DateTimeFormat(locale, locale === "zh-CN"
    ? { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" }
    : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export function formatWindow(start: string, end: string, locale: "zh-CN" | "en-US"): string {
  if (locale === "zh-CN") return formatWindowZh(start, end);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${new Intl.DateTimeFormat(locale, options).format(new Date(`${start}T12:00:00Z`))}–${new Intl.DateTimeFormat(locale, options).format(new Date(`${end}T12:00:00Z`))}`;
}
