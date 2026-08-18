import type { ScheduleData } from "../types/schedule";
import type { ReviewBundle } from "./review-report";
import type { WeeklyIngestionBundle } from "./weekly-ingestion";

/** Projects compiled public facts back into cinema groups for human diffing. */
export function compiledScheduleReviewBundle(
  source: WeeklyIngestionBundle,
  schedule: ScheduleData,
  resolvedWarnings: Record<string, string[]> = {},
): ReviewBundle {
  const filmsById = new Map(schedule.films.map((film) => [film.id, film]));
  return {
    generatedAt: source.generatedAt,
    windowStart: source.windowStart,
    windowEnd: source.windowEnd,
    adapters: source.adapters.map((adapter) => {
      const showings = schedule.showings.filter((showing) => showing.cinemaId === adapter.cinemaId);
      const filmIds = new Set(showings.map((showing) => showing.filmId));
      const resolved = new Set(resolvedWarnings[adapter.cinemaId] ?? []);
      const warnings = adapter.warnings.filter((warning) => !resolved.has(warning));
      const resolvedPartial = adapter.snapshot.result === "partial" && warnings.length === 0;
      return {
        ...adapter,
        warnings,
        snapshot: resolvedPartial
          ? { ...adapter.snapshot, result: "success", error: null }
          : adapter.snapshot,
        films: [...filmIds].map((id) => filmsById.get(id)).filter((film) => film !== undefined),
        showings,
      };
    }),
  };
}
