import { localPartsAtInstant } from "./timezone";
import type { ScheduleData, Showing } from "../types/schedule";

export type ValidationIssue = {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
};

export type ValidationReport = {
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
  publishable: boolean;
};

export type DeduplicationResult = {
  showings: Showing[];
  duplicates: Array<{ kept: Showing; removed: Showing }>;
};

function showingIdentity(showing: Showing): string {
  return JSON.stringify([
    showing.cinemaId,
    showing.filmId,
    showing.startsAt,
    showing.format,
    showing.eventType,
    showing.eventNote,
    showing.ticketUrl,
  ]);
}

export function deduplicateShowings(
  showings: readonly Showing[],
): DeduplicationResult {
  const seen = new Map<string, Showing>();
  const unique: Showing[] = [];
  const duplicates: DeduplicationResult["duplicates"] = [];

  for (const showing of showings) {
    const identity = showingIdentity(showing);
    const existing = seen.get(identity);
    if (existing) {
      duplicates.push({ kept: existing, removed: showing });
    } else {
      seen.set(identity, showing);
      unique.push(showing);
    }
  }
  return { showings: unique, duplicates };
}

function hostMatches(sourceUrl: string, allowedUrls: string[]): boolean {
  try {
    const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
    return allowedUrls.some((allowedUrl) => {
      const allowedHost = new URL(allowedUrl).hostname.toLowerCase();
      return (
        sourceHost === allowedHost ||
        sourceHost.endsWith(`.${allowedHost}`) ||
        allowedHost.endsWith(`.${sourceHost}`)
      );
    });
  } catch {
    return false;
  }
}

export function validateScheduleData(
  data: ScheduleData,
  options: {
    now?: Date;
    staleAfterHours?: number;
    staleExemptShowingIds?: ReadonlySet<string>;
  } = {},
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const now = options.now ?? new Date();
  const staleAfterMs = (options.staleAfterHours ?? 72) * 60 * 60 * 1_000;
  const cinemaById = new Map(data.cinemas.map((cinema) => [cinema.id, cinema]));
  const filmById = new Map(data.films.map((film) => [film.id, film]));
  const ids = new Set<string>();

  const add = (
    severity: ValidationIssue["severity"],
    code: string,
    path: string,
    message: string,
  ) => issues.push({ severity, code, path, message });

  if (data.metadata.windowStart > data.metadata.windowEnd) {
    add("error", "invalid_window", "metadata", "Window start is after window end.");
  }

  const unavailableKeys = new Set<string>();
  for (const [index, item] of (data.metadata.unavailableCinemaDates ?? []).entries()) {
    const key = `${item.cinemaId}:${item.localDate}`;
    if (!cinemaById.has(item.cinemaId)) {
      add("error", "unknown_unavailable_cinema", `metadata.unavailableCinemaDates[${index}]`, item.cinemaId);
    }
    if (item.localDate < data.metadata.windowStart || item.localDate > data.metadata.windowEnd) {
      add("error", "unavailable_outside_window", `metadata.unavailableCinemaDates[${index}]`, item.localDate);
    }
    if (unavailableKeys.has(key)) {
      add("error", "duplicate_unavailable_date", `metadata.unavailableCinemaDates[${index}]`, key);
    }
    unavailableKeys.add(key);
  }

  data.films.forEach((film, index) => {
    const hasDescription = Boolean(film.descriptionZh?.trim() || film.descriptionEn?.trim());
    const hasSource = Boolean(film.descriptionSource?.trim());
    if (hasDescription !== hasSource) {
      add(
        "error",
        "description_provenance",
        `films[${index}]`,
        "At least one localized description and its shared source must be present together.",
      );
    } else if (hasSource) {
      try {
        const source = new URL(film.descriptionSource!);
        if (source.protocol !== "https:") throw new Error("not HTTPS");
      } catch {
        add(
          "error",
          "description_source_url",
          `films[${index}].descriptionSource`,
          "Description source must be a valid HTTPS URL.",
        );
      }
    }
  });

  data.showings.forEach((showing, index) => {
    const path = `showings[${index}]`;
    const cinema = cinemaById.get(showing.cinemaId);
    const film = filmById.get(showing.filmId);

    if (ids.has(showing.id)) {
      add("error", "duplicate_id", `${path}.id`, `Duplicate showing ID: ${showing.id}`);
    }
    ids.add(showing.id);
    if (!cinema) add("error", "unknown_cinema", `${path}.cinemaId`, showing.cinemaId);
    if (!film) add("error", "unknown_film", `${path}.filmId`, showing.filmId);
    if (!film?.displayTitle.trim()) {
      add("error", "empty_title", `${path}.filmId`, "Film title is empty.");
    }
    if (
      showing.localDate < data.metadata.windowStart ||
      showing.localDate > data.metadata.windowEnd
    ) {
      add("error", "outside_window", `${path}.localDate`, showing.localDate);
    }

    const instant = new Date(showing.startsAt);
    if (Number.isNaN(instant.getTime()) || !/[+-]\d{2}:\d{2}$/.test(showing.startsAt)) {
      add("error", "invalid_starts_at", `${path}.startsAt`, showing.startsAt);
    } else {
      const local = localPartsAtInstant(instant, data.metadata.timezone);
      const expectedDate = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
      const expectedTime = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
      if (expectedDate !== showing.localDate || expectedTime !== showing.localTime) {
        add(
          "error",
          "local_time_mismatch",
          `${path}.startsAt`,
          `${showing.startsAt} resolves to ${expectedDate} ${expectedTime}`,
        );
      }
    }

    if (
      cinema &&
      !hostMatches(showing.sourceUrl, [cinema.officialUrl, cinema.scheduleUrl])
    ) {
      add("error", "source_domain", `${path}.sourceUrl`, showing.sourceUrl);
    }
    if (showing.fetchedAt === null) {
      add("warning", "missing_fetched_at", `${path}.fetchedAt`, "Manual review required.");
    } else {
      const fetchedAt = new Date(showing.fetchedAt);
      if (Number.isNaN(fetchedAt.getTime())) {
        add("error", "invalid_fetched_at", `${path}.fetchedAt`, showing.fetchedAt);
      } else if (
        now.getTime() - fetchedAt.getTime() > staleAfterMs &&
        !options.staleExemptShowingIds?.has(showing.id)
      ) {
        add("warning", "stale_showing", `${path}.fetchedAt`, showing.fetchedAt);
      }
    }
    if (showing.extractionStatus === "needs_review") {
      add("warning", "needs_review", `${path}.extractionStatus`, showing.id);
    }
  });

  for (const duplicate of deduplicateShowings(data.showings).duplicates) {
    add(
      "error",
      "duplicate_showing",
      "showings",
      `${duplicate.removed.id} duplicates ${duplicate.kept.id}`,
    );
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    issues,
    errors,
    warnings,
    publishable: errors === 0 && warnings === 0,
  };
}
