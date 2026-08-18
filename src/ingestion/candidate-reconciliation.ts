import type { ReviewBundle } from "./review-report";
import type { AdapterResult } from "./types";
import type { WeeklyIngestionBundle } from "./weekly-ingestion";

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

function validateFallbackFacts(
  adapter: AdapterResult,
  windowStart: string,
  windowEnd: string,
): void {
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
 * Keeps every clean current feed and replaces an unclean cinema atomically with
 * that cinema's facts from the exact previously approved week. It never mixes
 * a partial current response with approved facts.
 */
export function reconcileWeeklyCandidate(
  current: WeeklyIngestionBundle,
  previousApproved: ReviewBundle,
): WeeklyIngestionBundle {
  const previousByCinema = adapterMap(previousApproved.adapters, "Previous approved review bundle");
  adapterMap(current.adapters, "Current ingestion bundle");

  const adapters = current.adapters.map((adapter): AdapterResult => {
    if (adapter.snapshot.result === "success") {
      return { ...adapter, publicationFallback: undefined };
    }
    const previous = previousByCinema.get(adapter.cinemaId);
    if (!previous) {
      throw new Error(
        `Adapter ${adapter.cinemaId} is ${adapter.snapshot.result}, and no previous approved data exists for fallback.`,
      );
    }
    validateFallbackFacts(previous, current.windowStart, current.windowEnd);
    const sourceGeneratedAt = previous.publicationFallback?.sourceGeneratedAt ?? previousApproved.generatedAt;
    if (Number.isNaN(new Date(sourceGeneratedAt).getTime())) {
      throw new Error(`Previous approved ${adapter.cinemaId} fallback timestamp is invalid.`);
    }
    return {
      ...adapter,
      films: previous.films,
      showings: previous.showings,
      publicationFallback: { mode: "previous_approved", sourceGeneratedAt },
    };
  });

  return { ...current, adapters };
}
