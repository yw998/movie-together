import { load } from "cheerio";
import { parseDisplayTime } from "../../lib/time";
import { zonedLocalDateTimeToIso } from "../../lib/timezone";
import type { Film, Showing } from "../../types/schedule";
import type { AdapterResult, SourceSnapshot } from "../types";

export const METROGRAPH_SOURCE_URL = "https://metrograph.com/film/";
export const METROGRAPH_PARSER_VERSION = "metrograph-film-html-v2";

type ParseOptions = {
  fetchedAt: string;
  contentHash: string;
  windowStart: string;
  windowEnd: string;
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return dates;
  while (cursor <= last && dates.length <= 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function dateLabel(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(new Date(`${localDate}T12:00:00Z`))
    .replace(/,/g, "");
}

function resolveDate(dayId: string, options: ParseOptions): string | null {
  const label = dayId.replace(/^day_/, "").replace(/_/g, " ").toLowerCase();
  const matches = dateRange(options.windowStart, options.windowEnd).filter(
    (date) => dateLabel(date).toLowerCase() === label,
  );
  return matches.length === 1 ? matches[0] : null;
}

function getFormat(metadata: string, title: string): Showing["format"] {
  const value = `${metadata} ${title}`;
  if (/\b70mm\b/i.test(value)) return "70mm";
  if (/\b35mm\b/i.test(value)) return "35mm";
  if (/\b16mm\b/i.test(value)) return "16mm";
  if (/\b4K\s+DCP\b/i.test(value)) return "4K DCP";
  if (/\bDCP\b/i.test(value)) return "DCP";
  return null;
}

function getEventType(title: string): Showing["eventType"] {
  if (/Q\s*&\s*A/i.test(title)) return "qa";
  if (/members\s+only/i.test(title)) return "members_only";
  if (/open\s+captions?/i.test(title)) return "open_caption";
  if (/\bintro(?:duction|duced)?\b/i.test(title)) return "intro";
  return "standard";
}

function getSessionId(ticketUrl: string): string | null {
  try {
    const url = new URL(ticketUrl);
    if (url.hostname !== "t.metrograph.com") return null;
    const sessionId = url.searchParams.get("txtSessionId");
    return sessionId && /^\d+$/.test(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
}

function snapshot(
  options: ParseOptions,
  result: SourceSnapshot["result"],
  error: string | null,
): SourceSnapshot {
  return {
    cinemaId: "metrograph",
    fetchedAt: options.fetchedAt,
    sourceUrl: METROGRAPH_SOURCE_URL,
    contentHash: options.contentHash,
    parserVersion: METROGRAPH_PARSER_VERSION,
    result,
    error,
  };
}

export function parseMetrographHtml(
  html: string,
  options: ParseOptions,
): AdapterResult {
  const $ = load(html);
  const cards = $(".homepage-in-theater-movie");
  const warnings: string[] = [];
  const filmsById = new Map<string, Film>();
  const showings: Showing[] = [];

  if (cards.length === 0) {
    return {
      cinemaId: "metrograph",
      films: [],
      showings: [],
      snapshot: snapshot(options, "failed", "In-theater film cards were not found."),
      warnings: [],
    };
  }

  cards.each((cardIndex, cardElement) => {
    const card = $(cardElement);
    const titleAnchor = card.find(".movie_title > a").first();
    const title = cleanText(titleAnchor.text());
    const relativeDetailUrl = titleAnchor.attr("href")?.trim() ?? "";
    let detailUrl = "";
    try {
      detailUrl = new URL(relativeDetailUrl, METROGRAPH_SOURCE_URL).toString();
    } catch {
      // The validation below emits one review warning for this card.
    }
    const filmId = slugify(title);
    if (
      !title ||
      !filmId ||
      !detailUrl.startsWith("https://metrograph.com/film/")
    ) {
      warnings.push(`films[${cardIndex}] has no trustworthy title or detail URL.`);
      return;
    }

    const metadata = card
      .find("h5")
      .toArray()
      .map((element) => cleanText($(element).text()))
      .find((value) => /\b(?:16mm|35mm|70mm|DCP)\b/i.test(value)) ?? "";
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

    card.find(".showtimes .film_day").each((dayIndex, dayElement) => {
      const day = $(dayElement);
      const dayId = day.attr("id") ?? "";
      const localDate = resolveDate(dayId, options);
      if (!localDate) {
        // Old and future dates outside the requested window are expected on
        // Metrograph's long-running film page, so only malformed IDs warn.
        if (!/^day_[A-Z][a-z]{2}_[A-Z][a-z]{2}_\d{1,2}$/.test(dayId)) {
          warnings.push(`films[${cardIndex}].days[${dayIndex}] has an invalid date ID: ${dayId}`);
        }
        return;
      }

      day.children("a").each((timeIndex, timeElement) => {
        const anchor = $(timeElement);
        const displayTime = cleanText(anchor.text())
          .replace(/\s*(am|pm)$/i, " $1")
          .toUpperCase();
        const soldOut = anchor.hasClass("sold_out") || /sold\s*out/i.test(anchor.attr("title") ?? "");
        const ticketUrl = anchor.attr("href")?.trim() ?? "";
        const sessionId = soldOut ? null : getSessionId(ticketUrl);
        try {
          const localTime = parseDisplayTime(displayTime);
          if (!soldOut && !sessionId) {
            warnings.push(
              `films[${cardIndex}].days[${dayIndex}].times[${timeIndex}] has no trustworthy session ID.`,
            );
            return;
          }
          const showingId = sessionId
            ? `metrograph-${sessionId}`
            : `metrograph-sold-out-${filmId}-${localDate}-${localTime.replace(":", "")}`;
          showings.push({
            id: showingId,
            cinemaId: "metrograph",
            filmId,
            startsAt: zonedLocalDateTimeToIso(localDate, localTime),
            localDate,
            localTime,
            format: getFormat(metadata, title),
            eventType: getEventType(title),
            eventNote: null,
            detailUrl,
            ticketUrl: sessionId ? ticketUrl : null,
            availability: soldOut ? "sold_out" : "available",
            sourceUrl: METROGRAPH_SOURCE_URL,
            fetchedAt: options.fetchedAt,
            extractionStatus: "verified",
          });
        } catch (error) {
          warnings.push(
            `films[${cardIndex}].days[${dayIndex}].times[${timeIndex}] ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    });
  });

  if (showings.length === 0) {
    warnings.push("Official page contained no publishable showings; manual review required.");
  }
  const referencedFilmIds = new Set(showings.map((showing) => showing.filmId));
  return {
    cinemaId: "metrograph",
    films: [...filmsById.values()].filter((film) => referencedFilmIds.has(film.id)),
    showings,
    snapshot: snapshot(
      options,
      warnings.length === 0 ? "success" : "partial",
      warnings.length === 0 ? null : `${warnings.length} parser warning(s).`,
    ),
    warnings,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function metrographRequestUrl(fetchedAt: string): string {
  const instant = new Date(fetchedAt);
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid fetch instant: ${fetchedAt}`);
  const url = new URL(METROGRAPH_SOURCE_URL);
  // The bare /film/ URL can serve structurally valid but incomplete cached
  // HTML. One stable cache key per UTC hour refreshes the official page
  // without producing a unique cache entry for every request.
  url.searchParams.set("schedule_refresh", instant.toISOString().slice(0, 13));
  return url.toString();
}

export async function fetchMetrographSchedule(
  windowStart: string,
  windowEnd: string,
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const baseOptions = { fetchedAt, contentHash: "", windowStart, windowEnd };
  try {
    const response = await fetch(metrographRequestUrl(fetchedAt), {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "NYC-Repertory-Cinema-Week/0.1 (official schedule ingestion)",
      },
    });
    const html = await response.text();
    const contentHash = await sha256(html);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseMetrographHtml(html, { ...baseOptions, contentHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cinemaId: "metrograph",
      films: [],
      showings: [],
      snapshot: snapshot(baseOptions, "failed", message),
      warnings: [],
    };
  }
}
