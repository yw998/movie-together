import { cinemaCatalog } from "../data/cinemas";
import { calendarWeekFor } from "../lib/calendar-week";
import { validateScheduleData, deduplicateShowings } from "../lib/schedule-validation";
import { localPartsAtInstant } from "../lib/timezone";
import { NEW_YORK_TIMEZONE, type Film, type ScheduleData, type Showing } from "../types/schedule";
import type { ManualOverrideFile } from "./manual-overrides";
import { validateManualOverrideFile } from "./manual-overrides";
import { enrichFilmDescriptions } from "./film-description-enrichment";
import type { WeeklyIngestionBundle } from "./weekly-ingestion";

export type CompiledCandidate = {
  schedule: ScheduleData;
  removedByOverride: string[];
  appliedOverrides: number;
  resolvedWarnings: Record<string, string[]>;
};

function richerFilm(existing: Film, incoming: Film): Film {
  if (existing.canonicalTitle.toLocaleLowerCase() !== incoming.canonicalTitle.toLocaleLowerCase()) {
    throw new Error(`Film ID collision for ${existing.id}: ${existing.canonicalTitle} / ${incoming.canonicalTitle}`);
  }
  return {
    id: existing.id,
    canonicalTitle: existing.canonicalTitle,
    displayTitle: existing.displayTitle || incoming.displayTitle,
    year: existing.year ?? incoming.year,
    director: existing.director ?? incoming.director,
    runtimeMinutes: existing.runtimeMinutes ?? incoming.runtimeMinutes,
    descriptionZh: existing.descriptionZh ?? incoming.descriptionZh,
    descriptionEn: existing.descriptionEn ?? incoming.descriptionEn,
    descriptionSource: existing.descriptionSource ?? incoming.descriptionSource,
  };
}

function refreshLocalDate(generatedAt: string): string {
  const instant = new Date(generatedAt);
  if (Number.isNaN(instant.getTime())) throw new Error("Bundle generatedAt is invalid.");
  const local = localPartsAtInstant(instant);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

export function compileWeeklyCandidate(
  bundle: WeeklyIngestionBundle,
  overrideFile?: ManualOverrideFile,
  options: { requireCleanSources?: boolean } = {},
): CompiledCandidate {
  const expectedWindow = calendarWeekFor(bundle.windowStart);
  if (
    bundle.timezone !== NEW_YORK_TIMEZONE ||
    bundle.windowKind !== "calendar_week_monday_sunday" ||
    bundle.windowStart !== expectedWindow.start ||
    bundle.windowEnd !== expectedWindow.end
  ) {
    throw new Error("Candidate is not an exact Monday–Sunday New York calendar week.");
  }
  const expectedCinemas = new Set(cinemaCatalog.map((cinema) => cinema.id));
  const adapterIds = new Set(bundle.adapters.map((adapter) => adapter.cinemaId));
  for (const cinemaId of expectedCinemas) {
    if (!adapterIds.has(cinemaId)) throw new Error(`Candidate is missing adapter ${cinemaId}.`);
  }
  const films = new Map<string, Film>();
  const showings = new Map<string, Showing>();
  for (const adapter of bundle.adapters) {
    if (adapter.publicationFallback) {
      const fallbackAt = new Date(adapter.publicationFallback.sourceGeneratedAt).getTime();
      const currentAt = new Date(bundle.generatedAt).getTime();
      if (
        adapter.snapshot.result === "success" ||
        Number.isNaN(fallbackAt) ||
        Number.isNaN(currentAt) ||
        fallbackAt > currentAt
      ) {
        throw new Error(`Adapter ${adapter.cinemaId} has invalid approved fallback metadata.`);
      }
    }
    for (const film of adapter.films) {
      const existing = films.get(film.id);
      films.set(film.id, existing ? richerFilm(existing, film) : film);
    }
    for (const showing of adapter.showings) {
      if (showings.has(showing.id)) throw new Error(`Duplicate showing ID across adapters: ${showing.id}`);
      showings.set(showing.id, showing);
    }
  }

  const removedByOverride: string[] = [];
  const resolvedWarnings = new Map<string, Set<string>>();
  if (overrideFile) {
    const issues = validateManualOverrideFile(overrideFile, bundle.windowStart, bundle.windowEnd);
    if (issues.length > 0) throw new Error(issues.join(" "));
    for (const entry of overrideFile.entries) {
      let overrideCinemaId: string;
      if (entry.operation === "remove") {
        const removed = showings.get(entry.showingId);
        if (!removed) throw new Error(`Override cannot remove unknown showing ${entry.showingId}.`);
        const cinema = cinemaCatalog.find((item) => item.id === removed.cinemaId);
        const evidenceHost = new URL(entry.sourceUrl).hostname;
        const officialHosts = [cinema?.officialUrl, cinema?.scheduleUrl]
          .filter((value): value is string => Boolean(value))
          .map((value) => new URL(value).hostname);
        if (!officialHosts.some((host) => evidenceHost === host || evidenceHost.endsWith(`.${host}`) || host.endsWith(`.${evidenceHost}`))) {
          throw new Error(`Override source for ${entry.showingId} is not an official cinema domain.`);
        }
        showings.delete(entry.showingId);
        removedByOverride.push(entry.showingId);
        overrideCinemaId = removed.cinemaId;
      } else {
        const existing = films.get(entry.film.id);
        films.set(entry.film.id, existing ? richerFilm(existing, entry.film) : entry.film);
        showings.set(entry.showing.id, { ...entry.showing, fetchedAt: entry.enteredAt });
        overrideCinemaId = entry.showing.cinemaId;
      }
      for (const warning of entry.resolvesWarnings ?? []) {
        const adapter = bundle.adapters.find((item) => item.cinemaId === overrideCinemaId);
        if (!adapter?.warnings.includes(warning)) {
          throw new Error(`Override cannot resolve an unknown ${overrideCinemaId} warning: ${warning}`);
        }
        const resolved = resolvedWarnings.get(overrideCinemaId) ?? new Set<string>();
        resolved.add(warning);
        resolvedWarnings.set(overrideCinemaId, resolved);
      }
    }
  }

  if (options.requireCleanSources) {
    for (const adapter of bundle.adapters) {
      const hasApprovedFallback = adapter.publicationFallback?.mode === "previous_approved";
      if (adapter.snapshot.result === "failed" && !hasApprovedFallback) {
        throw new Error(`Adapter ${adapter.cinemaId} failed and is not publishable.`);
      }
      const resolved = resolvedWarnings.get(adapter.cinemaId) ?? new Set<string>();
      if (!hasApprovedFallback && adapter.warnings.some((warning) => !resolved.has(warning))) {
        throw new Error(`Adapter ${adapter.cinemaId} has unresolved review warnings.`);
      }
    }
  }

  const unique = deduplicateShowings([...showings.values()]);
  if (unique.duplicates.length > 0) {
    throw new Error(`Candidate contains ${unique.duplicates.length} duplicate showing fact(s).`);
  }
  const referencedFilmIds = new Set(unique.showings.map((showing) => showing.filmId));
  const referencedFilms = [...films.values()].filter((film) => referencedFilmIds.has(film.id));
  const enrichedFilms = enrichFilmDescriptions(referencedFilms, unique.showings);
  const schedule: ScheduleData = {
    metadata: {
      timezone: NEW_YORK_TIMEZONE,
      windowStart: bundle.windowStart,
      windowEnd: bundle.windowEnd,
      refreshedLocalDate: refreshLocalDate(bundle.generatedAt),
      provenanceNote: "Compiled from reviewed official cinema adapters; publication requires a matching approval artifact.",
    },
    cinemas: cinemaCatalog,
    films: enrichedFilms.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle)),
    showings: unique.showings.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)),
  };
  const validation = validateScheduleData(schedule, { now: new Date(bundle.generatedAt), staleAfterHours: 72 });
  if (!validation.publishable) {
    const messages = validation.issues.map((issue) => `${issue.path}: ${issue.message}`);
    throw new Error(`Compiled candidate failed validation: ${messages.join(" ")}`);
  }
  return {
    schedule,
    removedByOverride,
    appliedOverrides: overrideFile?.entries.length ?? 0,
    resolvedWarnings: Object.fromEntries(
      [...resolvedWarnings].map(([cinemaId, warnings]) => [cinemaId, [...warnings]]),
    ),
  };
}
