import type { Film, Showing } from "../../types/schedule";
import type { AdapterResult, SourceSnapshot } from "../types";

export const FILM_FORUM_API_URL =
  "https://my.filmforum.org/api/products/productionseasons";
export const FILM_FORUM_PARSER_VERSION = "film-forum-api-v1";

type FilmForumPerformance = {
  id: number;
  iso8601DateString: string;
  performanceTitle: string;
  actionUrl: string;
  isPerformanceVisible: boolean;
  isOnSale: boolean;
  performanceStatusMessage: string;
};

type FilmForumProduction = {
  productionTitle: string;
  productionSeasonActionUrl: string;
  performances: FilmForumPerformance[];
};

type FilmForumPayload = {
  productions: FilmForumProduction[];
};

type ParseOptions = {
  fetchedAt: string;
  contentHash: string;
  windowStart: string;
  windowEnd: string;
};

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeOfficialIso(value: string): string | null {
  const normalized = value.replace(/\.(\d{3})\d*([+-]\d{2}:\d{2})$/, ".$1$2");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(
      normalized,
    ) ||
    Number.isNaN(new Date(normalized).getTime())
  ) {
    return null;
  }
  return normalized;
}

function isPayload(value: unknown): value is FilmForumPayload {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as { productions?: unknown }).productions);
}

function snapshot(
  options: ParseOptions,
  result: SourceSnapshot["result"],
  error: string | null,
): SourceSnapshot {
  return {
    cinemaId: "film-forum",
    fetchedAt: options.fetchedAt,
    sourceUrl: FILM_FORUM_API_URL,
    contentHash: options.contentHash,
    parserVersion: FILM_FORUM_PARSER_VERSION,
    result,
    error,
  };
}

export function parseFilmForumPayload(
  payload: unknown,
  options: ParseOptions,
): AdapterResult {
  if (!isPayload(payload)) {
    return {
      cinemaId: "film-forum",
      films: [],
      showings: [],
      snapshot: snapshot(options, "failed", "Response has no productions array."),
      warnings: [],
    };
  }

  const filmsById = new Map<string, Film>();
  const showings: Showing[] = [];
  const warnings: string[] = [];

  payload.productions.forEach((production, productionIndex) => {
    if (
      !production ||
      typeof production.productionTitle !== "string" ||
      !Array.isArray(production.performances)
    ) {
      warnings.push(`productions[${productionIndex}] has an invalid shape.`);
      return;
    }

    const title = production.productionTitle.trim();
    const filmId = slugify(title);
    if (!title || !filmId) {
      warnings.push(`productions[${productionIndex}] has an empty title.`);
      return;
    }
    if (!filmsById.has(filmId)) {
      filmsById.set(filmId, {
        id: filmId,
        canonicalTitle: title,
        displayTitle: title,
        year: null,
        director: null,
        runtimeMinutes: null,
        descriptionZh: null,
        descriptionEn: null,
        descriptionSource: null,
      });
    }

    production.performances.forEach((performance, performanceIndex) => {
      const itemPath = `productions[${productionIndex}].performances[${performanceIndex}]`;
      if (!performance || typeof performance !== "object") {
        warnings.push(`${itemPath} has an invalid shape.`);
        return;
      }
      if (!performance.isPerformanceVisible) return;
      if (typeof performance.iso8601DateString !== "string") {
        warnings.push(`${itemPath} has no iso8601DateString.`);
        return;
      }
      const startsAt = normalizeOfficialIso(performance.iso8601DateString);
      if (!startsAt) {
        warnings.push(`${itemPath} has an invalid iso8601DateString.`);
        return;
      }
      const localDate = startsAt.slice(0, 10);
      if (localDate < options.windowStart || localDate > options.windowEnd) return;
      if (
        !Number.isInteger(performance.id) ||
        typeof performance.actionUrl !== "string" ||
        !performance.actionUrl.startsWith("https://my.filmforum.org/")
      ) {
        warnings.push(`${itemPath} has no trustworthy ID or ticket URL.`);
        return;
      }

      const status =
        typeof performance.performanceStatusMessage === "string"
          ? performance.performanceStatusMessage.trim()
          : "";
      const soldOut = /sold\s*out/i.test(status);
      showings.push({
        id: `film-forum-${performance.id}`,
        cinemaId: "film-forum",
        filmId,
        startsAt,
        localDate,
        localTime: startsAt.slice(11, 16),
        format: null,
        eventType: "other",
        eventNote: status || null,
        detailUrl:
          typeof production.productionSeasonActionUrl === "string" &&
          production.productionSeasonActionUrl.startsWith("https://my.filmforum.org/")
            ? production.productionSeasonActionUrl
            : performance.actionUrl,
        ticketUrl: performance.actionUrl,
        availability: soldOut
          ? "sold_out"
          : performance.isOnSale
            ? "available"
            : "unknown",
        sourceUrl: FILM_FORUM_API_URL,
        fetchedAt: options.fetchedAt,
        extractionStatus: "verified",
      });
    });
  });

  if (showings.length === 0) {
    warnings.push("Official response contained no publishable showings; manual review required.");
  }

  return {
    cinemaId: "film-forum",
    films: [...filmsById.values()],
    showings,
    snapshot: snapshot(
      options,
      warnings.length === 0 ? "success" : "partial",
      warnings.length === 0 ? null : `${warnings.length} record warning(s).`,
    ),
    warnings,
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchFilmForumSchedule(
  windowStart: string,
  windowEnd: string,
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const baseOptions = {
    fetchedAt,
    contentHash: "",
    windowStart,
    windowEnd,
  };

  try {
    const response = await fetch(FILM_FORUM_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent":
          "NYC-Repertory-Cinema-Week/0.1 (official schedule ingestion)",
      },
      body: JSON.stringify({
        startDate: `${windowStart}T00:00`,
        endDate: `${windowEnd}T23:59`,
        productionSeasonIdFilter: [],
        keywordIds: null,
      }),
    });
    const body = await response.text();
    const contentHash = await sha256(body);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parseFilmForumPayload(JSON.parse(body) as unknown, {
      ...baseOptions,
      contentHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cinemaId: "film-forum",
      films: [],
      showings: [],
      snapshot: snapshot(baseOptions, "failed", message),
      warnings: [],
    };
  }
}
