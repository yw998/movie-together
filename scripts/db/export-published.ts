import { writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";
import { zonedLocalDateTimeToIso } from "../../src/lib/timezone";
import { validateScheduleData } from "../../src/lib/schedule-validation";
import type { Cinema, Film, ScheduleData, Showing } from "../../src/types/schedule";

const [, , outputPath, anchorLocalDate] = process.argv;
if (!outputPath || !/^\d{4}-\d{2}-\d{2}$/.test(anchorLocalDate ?? "")) {
  console.error("Usage: npm run db:export -- output.json YYYY-MM-DD");
  process.exit(2);
}

function addDays(localDate: string, days: number): string {
  const value = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== localDate) {
    throw new Error(`Invalid rolling-window anchor: ${localDate}`);
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function instantText(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
function labels(start: string, end: string): Record<string, string> {
  const result: Record<string, string> = {};
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    result[date] = `${weekdays[cursor.getUTCDay()]} ${cursor.getUTCMonth() + 1}/${cursor.getUTCDate()}`;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

const sql = createDatabaseClient();
try {
  const rollingStart = anchorLocalDate!;
  const rollingEnd = addDays(rollingStart, 6);
  const weeks = await sql`
    select sw.* from schedule_weeks sw
    join published_weeks pw on pw.window_start = sw.window_start
    where sw.window_start <= ${rollingEnd}
      and sw.window_end >= ${rollingStart}
    order by sw.window_start
  `;
  if (weeks.length === 0) throw new Error(`No approved publication overlaps ${rollingStart} through ${rollingEnd}.`);
  const cinemaRows = await sql`select * from cinemas where enabled = true order by sort_order`;
  const filmRows = await sql`
    select distinct f.* from films f
    join showings s on s.film_id = f.id
    join published_weeks pw on pw.window_start = s.window_start
    where s.local_date between ${rollingStart} and ${rollingEnd}
      and s.publication_status = 'active'
    order by f.display_title, f.id
  `;
  const showingRows = await sql`
    select s.* from showings s
    join published_weeks pw on pw.window_start = s.window_start
    where s.local_date between ${rollingStart} and ${rollingEnd}
      and s.publication_status = 'active'
    order by s.starts_at, s.id
  `;
  const cinemas: Cinema[] = cinemaRows.map((row) => ({
    id: row.id, name: row.name, officialUrl: row.official_url,
    scheduleUrl: row.schedule_url, timezone: row.timezone,
    enabled: row.enabled, color: row.color,
  }));
  const films: Film[] = filmRows.map((row) => ({
    id: row.id, canonicalTitle: row.canonical_title, displayTitle: row.display_title,
    year: row.release_year, director: row.director, runtimeMinutes: row.runtime_minutes,
    descriptionZh: row.description_zh, descriptionSource: row.description_source,
  }));
  const showings: Showing[] = showingRows.map((row) => {
    const localDate = dateText(row.local_date);
    const localTime = String(row.local_time).slice(0, 5);
    return {
      id: row.id, cinemaId: row.cinema_id, filmId: row.film_id,
      startsAt: zonedLocalDateTimeToIso(localDate, localTime), localDate, localTime,
      format: row.format, eventType: row.event_type, eventNote: row.event_note,
      detailUrl: row.detail_url, ticketUrl: row.ticket_url, availability: row.availability,
      sourceUrl: row.source_url, fetchedAt: instantText(row.fetched_at),
      extractionStatus: row.extraction_status,
    };
  });
  const schedule: ScheduleData = {
    metadata: {
      timezone: "America/New_York",
      windowStart: rollingStart,
      windowEnd: rollingEnd,
      refreshedLocalDate: weeks.map((week) => dateText(week.refreshed_local_date)).sort().at(-1)!,
      provenanceNote: "Rolling seven-day publication assembled from approved New York calendar-week sources.",
    },
    cinemas,
    films,
    showings,
    dateLabels: labels(rollingStart, rollingEnd),
  };
  const validation = validateScheduleData(schedule, { staleAfterHours: Number.POSITIVE_INFINITY });
  if (validation.errors > 0) {
    throw new Error(`Database export failed validation: ${validation.issues.map((issue) => issue.message).join(" ")}`);
  }
  await writeFile(outputPath, `${JSON.stringify(schedule, null, 2)}\n`);
  console.log(`Exported ${films.length} films and ${showings.length} showings to ${outputPath}.`);
} finally {
  await sql.end();
}
