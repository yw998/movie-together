import { load } from "cheerio";
import { parseDisplayTime } from "../../lib/time";
import { zonedLocalDateTimeToIso } from "../../lib/timezone";
import type { Film, Showing } from "../../types/schedule";
import type { AdapterResult, SourceSnapshot } from "../types";

export const IFC_CENTER_SOURCE_URL = "https://www.ifccenter.com/";
export const IFC_CENTER_PARSER_VERSION = "ifc-center-html-v1";

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

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDateLabel(value: string): string {
  return cleanText(value).replace(/,/g, "").toLowerCase();
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

function officialDateLabel(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${localDate}T12:00:00Z`));
}

function resolveDate(label: string, options: ParseOptions): string | null {
  const normalized = normalizeDateLabel(label);
  const matches = dateRange(options.windowStart, options.windowEnd).filter(
    (date) => normalizeDateLabel(officialDateLabel(date)) === normalized,
  );
  return matches.length === 1 ? matches[0] : null;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveNearbyDate(label: string, options: ParseOptions): string | null {
  const normalized = normalizeDateLabel(label);
  const matches = dateRange(
    shiftDate(options.windowStart, -7),
    shiftDate(options.windowEnd, 7),
  ).filter((date) => normalizeDateLabel(officialDateLabel(date)) === normalized);
  return matches.length === 1 ? matches[0] : null;
}

function getTicketId(ticketUrl: string): string | null {
  try {
    const url = new URL(ticketUrl.trim());
    if (url.hostname !== "tickets.ifccenter.com") return null;
    const eventInfo = url.searchParams.get("evtinfo");
    const id = eventInfo?.split("~")[0];
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function getEventType(note: string): Showing["eventType"] {
  if (/q\s*&\s*a/i.test(note)) return "qa";
  if (/\bintro(?:duction|duced)?\b/i.test(note)) return "intro";
  return "other";
}

function snapshot(
  options: ParseOptions,
  result: SourceSnapshot["result"],
  error: string | null,
): SourceSnapshot {
  return {
    cinemaId: "ifc-center",
    fetchedAt: options.fetchedAt,
    sourceUrl: IFC_CENTER_SOURCE_URL,
    contentHash: options.contentHash,
    parserVersion: IFC_CENTER_PARSER_VERSION,
    result,
    error,
  };
}

export function parseIfcCenterHtml(
  html: string,
  options: ParseOptions,
): AdapterResult {
  const $ = load(html);
  const warnings: string[] = [];
  const filmsById = new Map<string, Film>();
  const showings: Showing[] = [];
  const schedules = $("#js-showtimes-widget .daily-schedule");

  if (schedules.length === 0) {
    return {
      cinemaId: "ifc-center",
      films: [],
      showings: [],
      snapshot: snapshot(options, "failed", "Showtimes widget was not found."),
      warnings: [],
    };
  }

  schedules.each((scheduleIndex, scheduleElement) => {
    const schedule = $(scheduleElement);
    const dateLabel = cleanText(schedule.children("h3").first().text());
    const localDate = resolveDate(dateLabel, options);
    if (!localDate) {
      if (dateLabel.toLowerCase() === "coming soon") return;
      if (resolveNearbyDate(dateLabel, options)) return;
      warnings.push(`daily-schedule[${scheduleIndex}] has an unresolved date: ${dateLabel}`);
      return;
    }

    schedule.children("ul").first().children("li").each((filmIndex, filmElement) => {
      const filmRow = $(filmElement);
      const detailAnchor = filmRow.find(".details > h3 > a").first();
      const title = cleanText(detailAnchor.text());
      const detailUrl = detailAnchor.attr("href")?.trim() ?? "";
      const filmId = slugify(title);
      const itemPath = `daily-schedule[${scheduleIndex}].films[${filmIndex}]`;
      if (
        !title ||
        !filmId ||
        !detailUrl.startsWith("https://www.ifccenter.com/films/")
      ) {
        warnings.push(`${itemPath} has no trustworthy title or detail URL.`);
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
          descriptionSource: null,
        });
      }

      const timeAnchors = filmRow.find(".details .times > li > a");
      if (timeAnchors.length === 0) {
        warnings.push(`${itemPath} has no showtime links.`);
      }
      timeAnchors.each((timeIndex, timeElement) => {
        const anchor = $(timeElement);
        const displayTime = cleanText(anchor.text()).toUpperCase();
        const ticketUrl = anchor.attr("href")?.trim() ?? "";
        const ticketId = getTicketId(ticketUrl);
        try {
          const localTime = parseDisplayTime(displayTime);
          if (!ticketId) {
            warnings.push(`${itemPath}.times[${timeIndex}] has no trustworthy ticket ID.`);
            return;
          }
          showings.push({
            id: `ifc-center-${ticketId}`,
            cinemaId: "ifc-center",
            filmId,
            startsAt: zonedLocalDateTimeToIso(localDate, localTime),
            localDate,
            localTime,
            format: null,
            eventType: "standard",
            eventNote: null,
            detailUrl,
            ticketUrl,
            availability: "unknown",
            sourceUrl: IFC_CENTER_SOURCE_URL,
            fetchedAt: options.fetchedAt,
            extractionStatus: "verified",
          });
        } catch (error) {
          warnings.push(
            `${itemPath}.times[${timeIndex}] ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    });
  });

  const seenSpecialEvents = new Set<string>();
  $(".ipe-single-container").each((eventIndex, eventElement) => {
    const event = $(eventElement);
    const dateText = cleanText(event.find("p > span").first().text()).replace(/:$/, "");
    const title = cleanText(event.find(".ipe-title").first().text());
    const note = cleanText(event.find(".ipe-caption").first().text());
    if (!dateText || !title || !note) return;
    const eventIdentity = `${dateText}\u0000${title}\u0000${note}`;
    if (seenSpecialEvents.has(eventIdentity)) return;
    seenSpecialEvents.add(eventIdentity);
    const localDate = resolveDate(dateText, options);
    if (!localDate && resolveNearbyDate(dateText, options)) return;
    const clockMatches = [...note.matchAll(/\b(\d{1,2}:\d{2})(?:\s*(AM|PM))?\b/gi)];
    if (!localDate || clockMatches.length === 0) {
      warnings.push(`special-event[${eventIndex}] could not be tied to one showtime: ${dateText} ${title}`);
      return;
    }

    const filmId = slugify(title);
    const candidates = showings.filter((showing) => {
      if (showing.localDate !== localDate || showing.filmId !== filmId) return false;
      return clockMatches.some((match) => {
        if (match[2]) {
          return parseDisplayTime(`${match[1]} ${match[2].toUpperCase()}`) === showing.localTime;
        }
        const [hour, minute] = showing.localTime.split(":").map(Number);
        const hour12 = hour % 12 || 12;
        return `${hour12}:${String(minute).padStart(2, "0")}` === match[1];
      });
    });
    if (candidates.length !== 1) {
      warnings.push(`special-event[${eventIndex}] matched ${candidates.length} showtimes: ${dateText} ${title}`);
      return;
    }
    candidates[0].eventType = getEventType(note);
    candidates[0].eventNote = note;
  });

  if (showings.length === 0) {
    warnings.push("Official page contained no publishable showings; manual review required.");
  }
  return {
    cinemaId: "ifc-center",
    films: [...filmsById.values()],
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

export async function fetchIfcCenterSchedule(
  windowStart: string,
  windowEnd: string,
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const baseOptions = { fetchedAt, contentHash: "", windowStart, windowEnd };
  try {
    const response = await fetch(IFC_CENTER_SOURCE_URL, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "NYC-Repertory-Cinema-Week/0.1 (official schedule ingestion)",
      },
    });
    const html = await response.text();
    const contentHash = await sha256(html);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseIfcCenterHtml(html, { ...baseOptions, contentHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cinemaId: "ifc-center",
      films: [],
      showings: [],
      snapshot: snapshot(baseOptions, "failed", message),
      warnings: [],
    };
  }
}
