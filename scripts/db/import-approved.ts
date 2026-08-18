import { readFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";
import { compiledScheduleReviewBundle } from "../../src/ingestion/compiled-review";
import type { ManualOverrideFile } from "../../src/ingestion/manual-overrides";
import { prepareApprovedSchedule } from "../../src/ingestion/promotion";
import type { ReviewApproval } from "../../src/ingestion/review-approval";
import { digestReviewBundle } from "../../src/ingestion/review-digest";
import type { ReviewBundle, ReviewReport } from "../../src/ingestion/review-report";
import type { WeeklyIngestionBundle } from "../../src/ingestion/weekly-ingestion";
import type { ScheduleData } from "../../src/types/schedule";

const [
  , , candidatePath, compiledPath, reviewBundlePath, overridePath, reportPath, approvalPath,
] = process.argv;
if (!candidatePath || !compiledPath || !reviewBundlePath || !overridePath || !reportPath || !approvalPath) {
  console.error(
    "Usage: npm run db:import -- candidate.json compiled.json review-bundle.json overrides.json report.json approval.json",
  );
  process.exit(2);
}

async function jsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const [candidate, compiledFile, reviewBundleFile, overrides, report, approval] = await Promise.all([
  jsonFile<WeeklyIngestionBundle>(candidatePath),
  jsonFile<ScheduleData>(compiledPath),
  jsonFile<ReviewBundle>(reviewBundlePath),
  jsonFile<ManualOverrideFile>(overridePath),
  jsonFile<ReviewReport>(reportPath),
  jsonFile<ReviewApproval>(approvalPath),
]);

const compiled = await prepareApprovedSchedule(candidate, approval, overrides);
if (JSON.stringify(compiled) !== JSON.stringify(compiledFile)) {
  throw new Error("Compiled schedule file does not match the approved source candidate.");
}
const projectedReview = compiledScheduleReviewBundle(candidate, compiled, Object.fromEntries(
  candidate.adapters.map((adapter) => [
    adapter.cinemaId,
    overrides.entries.flatMap((entry) => entry.resolvesWarnings ?? []).filter((warning) => adapter.warnings.includes(warning)),
  ]),
));
const projectedDigest = await digestReviewBundle(projectedReview);
if (projectedDigest !== report.candidateDigest || projectedDigest !== approval.candidateDigest) {
  throw new Error("Review, approval, and compiled candidate digests do not match.");
}
if (JSON.stringify(projectedReview) !== JSON.stringify(reviewBundleFile)) {
  throw new Error("Review bundle file does not match the approved compiled facts.");
}

const sql = createDatabaseClient();
try {
  await sql.begin(async (transaction) => {
    for (const [sortOrder, cinema] of compiled.cinemas.entries()) {
      await transaction`
        insert into cinemas (id, name, official_url, schedule_url, timezone, enabled, color, sort_order)
        values (${cinema.id}, ${cinema.name}, ${cinema.officialUrl}, ${cinema.scheduleUrl}, ${cinema.timezone}, ${cinema.enabled}, ${cinema.color}, ${sortOrder})
        on conflict (id) do update set
          name = excluded.name, official_url = excluded.official_url,
          schedule_url = excluded.schedule_url, timezone = excluded.timezone,
          enabled = excluded.enabled, color = excluded.color, sort_order = excluded.sort_order
      `;
    }
    for (const film of compiled.films) {
      await transaction`
        insert into films (id, canonical_title, display_title, release_year, director, runtime_minutes, description_zh, description_en, description_source)
        values (${film.id}, ${film.canonicalTitle}, ${film.displayTitle}, ${film.year}, ${film.director}, ${film.runtimeMinutes}, ${film.descriptionZh}, ${film.descriptionEn ?? null}, ${film.descriptionSource})
        on conflict (id) do update set
          canonical_title = excluded.canonical_title, display_title = excluded.display_title,
          release_year = excluded.release_year, director = excluded.director,
          runtime_minutes = excluded.runtime_minutes, description_zh = excluded.description_zh,
          description_en = excluded.description_en,
          description_source = excluded.description_source
      `;
    }
    await transaction`
      insert into ingestion_runs (id, generated_at, window_start, window_end, timezone, window_kind)
      values (${candidate.generatedAt}, ${candidate.generatedAt}, ${candidate.windowStart}, ${candidate.windowEnd}, ${candidate.timezone}, ${candidate.windowKind})
      on conflict (id) do nothing
    `;
    for (const adapter of candidate.adapters) {
      const snapshot = adapter.snapshot;
      await transaction`
        insert into source_snapshots
          (run_id, cinema_id, fetched_at, source_url, content_hash, parser_version, result, error, warnings)
        values
          (${candidate.generatedAt}, ${adapter.cinemaId}, ${snapshot.fetchedAt}, ${snapshot.sourceUrl},
           ${snapshot.contentHash}, ${snapshot.parserVersion}, ${snapshot.result}, ${snapshot.error},
           ${transaction.json(adapter.warnings)})
        on conflict (run_id, cinema_id) do update set
          fetched_at = excluded.fetched_at, source_url = excluded.source_url,
          content_hash = excluded.content_hash, parser_version = excluded.parser_version,
          result = excluded.result, error = excluded.error, warnings = excluded.warnings
      `;
    }
    await transaction`
      insert into schedule_weeks
        (window_start, window_end, timezone, refreshed_local_date, provenance_note, unavailable_cinema_dates, run_id)
      values
        (${compiled.metadata.windowStart}, ${compiled.metadata.windowEnd}, ${compiled.metadata.timezone},
         ${compiled.metadata.refreshedLocalDate}, ${compiled.metadata.provenanceNote},
         ${transaction.json(compiled.metadata.unavailableCinemaDates ?? [])}, ${candidate.generatedAt})
      on conflict (window_start) do update set
        window_end = excluded.window_end, timezone = excluded.timezone,
        refreshed_local_date = excluded.refreshed_local_date,
        provenance_note = excluded.provenance_note,
        unavailable_cinema_dates = excluded.unavailable_cinema_dates,
        run_id = excluded.run_id
    `;
    // Keep stable showing rows so future user watch marks cannot be orphaned by
    // a weekly refresh. Rows missing from the latest approved candidate remain
    // auditable but are excluded from the public export.
    await transaction`
      update showings
      set publication_status = 'removed'
      where window_start = ${compiled.metadata.windowStart}
    `;
    for (const film of compiled.films) {
      await transaction`
        insert into schedule_films (window_start, film_id)
        values (${compiled.metadata.windowStart}, ${film.id})
        on conflict (window_start, film_id) do nothing
      `;
    }
    for (const showing of compiled.showings) {
      await transaction`
        insert into showings
          (window_start, id, cinema_id, film_id, starts_at, local_date, local_time, format,
           event_type, event_note, detail_url, ticket_url, availability, source_url,
           fetched_at, extraction_status, publication_status)
        values
          (${compiled.metadata.windowStart}, ${showing.id}, ${showing.cinemaId}, ${showing.filmId},
           ${showing.startsAt}, ${showing.localDate}, ${showing.localTime}, ${showing.format},
           ${showing.eventType}, ${showing.eventNote}, ${showing.detailUrl}, ${showing.ticketUrl},
           ${showing.availability}, ${showing.sourceUrl}, ${showing.fetchedAt}, ${showing.extractionStatus}, 'active')
        on conflict (window_start, id) do update set
          cinema_id = excluded.cinema_id, film_id = excluded.film_id,
          starts_at = excluded.starts_at, local_date = excluded.local_date,
          local_time = excluded.local_time, format = excluded.format,
          event_type = excluded.event_type, event_note = excluded.event_note,
          detail_url = excluded.detail_url, ticket_url = excluded.ticket_url,
          availability = excluded.availability, source_url = excluded.source_url,
          fetched_at = excluded.fetched_at, extraction_status = excluded.extraction_status,
          publication_status = 'active'
      `;
    }
    await transaction`delete from manual_overrides where run_id = ${candidate.generatedAt}`;
    for (const entry of overrides.entries) {
      const showingId = entry.operation === "remove" ? entry.showingId : entry.showing.id;
      await transaction`
        insert into manual_overrides
          (run_id, window_start, operation, showing_id, source_url, reason, entered_at, resolves_warnings, payload)
        values
          (${candidate.generatedAt}, ${overrides.windowStart}, ${entry.operation}, ${showingId},
           ${entry.sourceUrl}, ${entry.reason}, ${entry.enteredAt},
           ${transaction.json(entry.resolvesWarnings ?? [])}, ${transaction.json(entry)})
      `;
    }
    await transaction`
      insert into review_reports
        (candidate_digest, run_id, generated_at, publishable, approval_required, summary, report)
      values
        (${report.candidateDigest}, ${candidate.generatedAt}, ${report.generatedAt}, ${report.publishable},
         ${report.approvalRequired}, ${transaction.json(report.summary)}, ${transaction.json(report)})
      on conflict (candidate_digest) do update set report = excluded.report, summary = excluded.summary
    `;
    await transaction`
      insert into approvals
        (candidate_digest, report_generated_at, approved_at, approved_by, decision, reviewed_summary)
      values
        (${approval.candidateDigest}, ${approval.reportGeneratedAt}, ${approval.approvedAt},
         ${approval.approvedBy}, ${approval.decision}, ${transaction.json(approval.reviewedSummary)})
      on conflict (candidate_digest) do nothing
    `;
    const artifacts = {
      candidate,
      compiled_schedule: compiled,
      review_bundle: reviewBundleFile,
      review_report: report,
      approval,
      manual_overrides: overrides,
    } as const;
    for (const [kind, content] of Object.entries(artifacts)) {
      await transaction`
        insert into workflow_artifacts (run_id, kind, content)
        values (${candidate.generatedAt}, ${kind}, ${transaction.json(content)})
        on conflict (run_id, kind) do update set content = excluded.content
      `;
    }
    await transaction`update published_weeks set is_current = false where is_current`;
    await transaction`
      insert into published_weeks (window_start, candidate_digest, is_current)
      values (${compiled.metadata.windowStart}, ${approval.candidateDigest}, true)
      on conflict (window_start) do update set
        candidate_digest = excluded.candidate_digest, published_at = now(), is_current = true
    `;
  });
  console.log(
    `Imported approved week ${compiled.metadata.windowStart}: ${compiled.films.length} films, ` +
    `${compiled.showings.length} showings, ${overrides.entries.length} override(s).`,
  );
} finally {
  await sql.end();
}
