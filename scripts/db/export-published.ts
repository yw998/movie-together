import { writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";
import { zonedLocalDateTimeToIso } from "../../src/lib/timezone";
import { validateScheduleData } from "../../src/lib/schedule-validation";
import type { Cinema, Film, ScheduleData, Showing } from "../../src/types/schedule";

const [, , outputPath] = process.argv;
if (!outputPath) {
  console.error("Usage: npm run db:export -- output.json");
  process.exit(2);
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
  const weeks = await sql`
    select sw.* from schedule_weeks sw
    join published_weeks pw on pw.window_start = sw.window_start
    where pw.is_current = true
  `;
  if (weeks.length !== 1) throw new Error(`Expected one current published week, found ${weeks.length}.`);
  const week = weeks[0];
  const windowStart = dateText(week.window_start);
  const windowEnd = dateText(week.window_end);
  const cinemaRows = await sql`select * from cinemas where enabled = true order by sort_order`;
  const filmRows = await sql`
    select f.* from films f
    join schedule_films sf on sf.film_id = f.id
    where sf.window_start = ${windowStart}
    order by f.display_title, f.id
  `;
  const showingRows = await sql`
    select * from showings where window_start = ${windowStart}
    order by starts_at, id
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
      timezone: week.timezone,
      windowStart,
      windowEnd,
      refreshedLocalDate: dateText(week.refreshed_local_date),
      provenanceNote: week.provenance_note,
    },
    cinemas,
    films,
    showings,
    dateLabels: labels(windowStart, windowEnd),
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
