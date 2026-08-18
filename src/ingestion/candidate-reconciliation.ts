import { datesForWindow } from "../lib/rolling-window";
import type { ReviewBundle } from "./review-report";
import type { AdapterResult } from "./types";
import type { ScheduleIngestionBundle } from "./weekly-ingestion";

function adapterMap(adapters: readonly AdapterResult[], label: string): Map<string, AdapterResult> {
  const result = new Map<string, AdapterResult>();
  for (const adapter of adapters) {
    if (result.has(adapter.cinemaId)) {
      throw new Error(`${label} contains duplicate adapter ${adapter.cinemaId}.`);
    }
    result.set(adapter.cinemaId, adapter);
  }
  return result;
}

function validatePreviousFacts(adapter: AdapterResult, windowStart: string, windowEnd: string): void {
  for (const showing of adapter.showings) {
    if (showing.cinemaId !== adapter.cinemaId) {
      throw new Error(`Previous approved ${adapter.cinemaId} data contains a showing for ${showing.cinemaId}.`);
    }
    if (showing.localDate < windowStart || showing.localDate > windowEnd) {
      throw new Error(`Previous approved ${adapter.cinemaId} data is outside ${windowStart} through ${windowEnd}.`);
    }
  }
}

/**
 * Keeps clean current cinema feeds. An unclean feed is discarded atomically,
 * then rebuilt only from dates covered by the previous approved window. Dates
 * with no approved coverage are explicitly omitted instead of blocking other
 * cinemas or admitting partial current facts.
 */
export function reconcileRollingCandidate(
  current: ScheduleIngestionBundle,
  previousApproved: ReviewBundle,
): ScheduleIngestionBundle {
  const previousByCinema = adapterMap(previousApproved.adapters, "Previous approved review bundle");
  adapterMap(current.adapters, "Current ingestion bundle");
  const dates = datesForWindow(current.windowStart, current.windowEnd);
  const previousStart = previousApproved.windowStart;
  const previousEnd = previousApproved.windowEnd;

  const adapters = current.adapters.map((adapter): AdapterResult => {
    if (adapter.snapshot.result === "success") {
      return { ...adapter, publicationFallback: undefined };
    }

    const previous = previousByCinema.get(adapter.cinemaId);
    const fallbackDates = previous && previousStart && previousEnd
      ? dates.filter((date) => date >= previousStart && date <= previousEnd)
      : [];
    const unavailableDates = dates.filter((date) => !fallbackDates.includes(date));
    const fallbackSet = new Set(fallbackDates);
    const showings = previous?.showings.filter((showing) => fallbackSet.has(showing.localDate)) ?? [];
    const filmIds = new Set(showings.map((showing) => showing.filmId));
    const films = previous?.films.filter((film) => filmIds.has(film.id)) ?? [];

    if (previous && previousStart && previousEnd) {
      validatePreviousFacts(previous, previousStart, previousEnd);
    }
    const inheritedSource = previous?.publicationFallback?.sourceGeneratedAt;
    const sourceGeneratedAt = fallbackDates.length > 0
      ? inheritedSource ?? previousApproved.generatedAt
      : null;
    if (sourceGeneratedAt && Number.isNaN(new Date(sourceGeneratedAt).getTime())) {
      throw new Error(`Previous approved ${adapter.cinemaId} fallback timestamp is invalid.`);
    }

    return {
      ...adapter,
      films,
      showings,
      publicationFallback: {
        mode: "date_scoped",
        sourceGeneratedAt,
        fallbackDates,
        unavailableDates,
      },
    };
  });

  if (adapters.every((adapter) => adapter.showings.length === 0)) {
    throw new Error("No verified or previously approved showings remain in the rolling window.");
  }
  return { ...current, adapters };
}

/** @deprecated Use rolling-window reconciliation. */
export const reconcileWeeklyCandidate = reconcileRollingCandidate;
