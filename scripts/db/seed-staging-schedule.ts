import { readFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";
import { calendarWeekFor } from "../../src/lib/calendar-week";
import { validateScheduleData } from "../../src/lib/schedule-validation";
import type { ScheduleData } from "../../src/types/schedule";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
const confirmedRef = process.env.STAGING_SEED_PROJECT_REF?.trim();
if (!projectRef || confirmedRef !== projectRef) {
  throw new Error("STAGING_SEED_PROJECT_REF must exactly match SUPABASE_PROJECT_REF.");
}

const schedule = JSON.parse(
  await readFile("src/data/published-schedule.json", "utf8"),
) as ScheduleData;
const validation = validateScheduleData(schedule, { staleAfterHours: Number.POSITIVE_INFINITY });
if (validation.errors > 0) {
  throw new Error(`Published schedule failed validation: ${validation.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("; ")}`);
}

const weeks = [...new Set(schedule.showings.map((showing) => calendarWeekFor(showing.localDate).start))].sort();
const sql = createDatabaseClient();
try {
  await sql.begin(async (transaction) => {
    for (const [sortOrder, cinema] of schedule.cinemas.entries()) {
      await transaction`
        insert into public.cinemas
          (id, name, official_url, schedule_url, timezone, enabled, color, sort_order)
        values
          (${cinema.id}, ${cinema.name}, ${cinema.officialUrl}, ${cinema.scheduleUrl},
           ${cinema.timezone}, ${cinema.enabled}, ${cinema.color}, ${sortOrder})
        on conflict (id) do update set
          name = excluded.name,
          official_url = excluded.official_url,
          schedule_url = excluded.schedule_url,
          timezone = excluded.timezone,
          enabled = excluded.enabled,
          color = excluded.color,
          sort_order = excluded.sort_order
      `;
    }

    for (const film of schedule.films) {
      await transaction`
        insert into public.films
          (id, canonical_title, display_title, release_year, director, runtime_minutes,
           description_zh, description_en, description_source)
        values
          (${film.id}, ${film.canonicalTitle}, ${film.displayTitle}, ${film.year}, ${film.director},
           ${film.runtimeMinutes}, ${film.descriptionZh}, ${film.descriptionEn ?? null}, ${film.descriptionSource})
        on conflict (id) do update set
          canonical_title = excluded.canonical_title,
          display_title = excluded.display_title,
          release_year = excluded.release_year,
          director = excluded.director,
          runtime_minutes = excluded.runtime_minutes,
          description_zh = excluded.description_zh,
          description_en = excluded.description_en,
          description_source = excluded.description_source
      `;
    }

    for (const [weekIndex, weekStart] of weeks.entries()) {
      const week = calendarWeekFor(weekStart);
      const runId = `staging-seed:${weekStart}`;
      const generatedAt = `${weekStart}T0${weekIndex}:00:00.000Z`;
      await transaction`
        insert into public.ingestion_runs
          (id, generated_at, window_start, window_end, timezone, window_kind)
        values
          (${runId}, ${generatedAt}, ${week.start}, ${week.end},
           'America/New_York', 'calendar_week_monday_sunday')
        on conflict (id) do nothing
      `;
      await transaction`
        insert into public.schedule_weeks
          (window_start, window_end, timezone, refreshed_local_date, provenance_note, run_id)
        values
          (${week.start}, ${week.end}, 'America/New_York', ${schedule.metadata.refreshedLocalDate},
           'Staging-only seed copied from the validated published static schedule.', ${runId})
        on conflict (window_start) do update set
          window_end = excluded.window_end,
          refreshed_local_date = excluded.refreshed_local_date,
          provenance_note = excluded.provenance_note,
          run_id = excluded.run_id
      `;
      await transaction`
        update public.showings set publication_status = 'removed'
        where window_start = ${week.start}
      `;
    }

    for (const showing of schedule.showings) {
      const weekStart = calendarWeekFor(showing.localDate).start;
      await transaction`
        insert into public.schedule_films(window_start, film_id)
        values (${weekStart}, ${showing.filmId})
        on conflict (window_start, film_id) do nothing
      `;
      await transaction`
        insert into public.showings
          (window_start, id, cinema_id, film_id, starts_at, local_date, local_time, format,
           event_type, event_note, detail_url, ticket_url, availability, source_url,
           fetched_at, extraction_status, publication_status)
        values
          (${weekStart}, ${showing.id}, ${showing.cinemaId}, ${showing.filmId}, ${showing.startsAt},
           ${showing.localDate}, ${showing.localTime}, ${showing.format}, ${showing.eventType},
           ${showing.eventNote}, ${showing.detailUrl}, ${showing.ticketUrl}, ${showing.availability},
           ${showing.sourceUrl}, ${showing.fetchedAt}, ${showing.extractionStatus}, 'active')
        on conflict (window_start, id) do update set
          cinema_id = excluded.cinema_id,
          film_id = excluded.film_id,
          starts_at = excluded.starts_at,
          local_date = excluded.local_date,
          local_time = excluded.local_time,
          format = excluded.format,
          event_type = excluded.event_type,
          event_note = excluded.event_note,
          detail_url = excluded.detail_url,
          ticket_url = excluded.ticket_url,
          availability = excluded.availability,
          source_url = excluded.source_url,
          fetched_at = excluded.fetched_at,
          extraction_status = excluded.extraction_status,
          publication_status = 'active'
      `;
    }
  });
  console.log(`Seeded staging with ${schedule.showings.length} active showings across ${weeks.length} weeks.`);
} finally {
  await sql.end();
}
