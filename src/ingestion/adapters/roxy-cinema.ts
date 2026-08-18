import { load } from "cheerio";
import type { Film, Showing } from "../../types/schedule";
import type { AdapterResult, SourceSnapshot } from "../types";

export const ROXY_SOURCE_URL =
  "https://www.roxycinemanewyork.com/now-showing/";
export const ROXY_PARSER_VERSION = "roxy-cinema-html-v1";

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

function normalizeOfficialIso(value: string): string | null {
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
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

function getFormat(title: string): Showing["format"] {
  if (/\b70MM\b/i.test(title)) return "70mm";
  if (/\b35MM\b/i.test(title)) return "35mm";
  if (/\b16MM\b/i.test(title)) return "16mm";
  if (/\b4K\s+DCP\b/i.test(title)) return "4K DCP";
  if (/\bDCP\b/i.test(title)) return "DCP";
  return null;
}

function getTicketId(ticketUrl: string): string | null {
  try {
    const url = new URL(ticketUrl);
    if (url.hostname !== "ticketing.uswest.veezi.com") return null;
    const match = url.pathname.match(/^\/purchase\/(\d+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function extractEventNote(
  title: string,
  copy: string,
  localDate: string,
): { eventType: Showing["eventType"]; eventNote: string | null } {
  if (/Q\s*&\s*A/i.test(title)) {
    const sentences = copy.match(/[^.!?]*(?:Q\s*&\s*A)[^.!?]*(?:[.!?]|$)/gi);
    return {
      eventType: "qa",
      eventNote: sentences?.map(cleanText).filter(Boolean).join(" ") || "Q&A",
    };
  }

  const introduction = copy.match(
    /\b(?:introduced|introduction)\s+by\s+[^.!?]+?(?:\s+(\d{1,2})\/(\d{1,2}))?(?:[.!?]|$)/i,
  );
  if (introduction?.[1] && introduction[2]) {
    const [, month, day] = localDate.split("-").map(Number);
    if (month === Number(introduction[1]) && day === Number(introduction[2])) {
      return { eventType: "intro", eventNote: cleanText(introduction[0]) };
    }
  }
  return { eventType: "standard", eventNote: null };
}

function snapshot(
  options: ParseOptions,
  result: SourceSnapshot["result"],
  error: string | null,
): SourceSnapshot {
  return {
    cinemaId: "roxy-cinema",
    fetchedAt: options.fetchedAt,
    sourceUrl: ROXY_SOURCE_URL,
    contentHash: options.contentHash,
    parserVersion: ROXY_PARSER_VERSION,
    result,
    error,
  };
}

export function parseRoxyCinemaHtml(
  html: string,
  options: ParseOptions,
): AdapterResult {
  const $ = load(html);
  const cards = $(".detailed-screening__card[data-datetime]");
  const warnings: string[] = [];
  const filmsById = new Map<string, Film>();
  const showings: Showing[] = [];

  if (cards.length === 0) {
    return {
      cinemaId: "roxy-cinema",
      films: [],
      showings: [],
      snapshot: snapshot(options, "failed", "Screening cards were not found."),
      warnings: [],
    };
  }

  cards.each((index, element) => {
    const card = $(element);
    const startsAt = normalizeOfficialIso(card.attr("data-datetime") ?? "");
    if (!startsAt) {
      warnings.push(`screenings[${index}] has an invalid data-datetime.`);
      return;
    }
    const localDate = startsAt.slice(0, 10);
    if (localDate < options.windowStart || localDate > options.windowEnd) return;

    const title = cleanText(card.find(".detailed-screening__title").first().text());
    const filmId = slugify(title);
    const detailUrl =
      card
        .find('.detailed-screening__cta.cta--text-link[href*="/screenings/"]')
        .first()
        .attr("href")
        ?.trim() ?? "";
    const ticketUrl =
      card
        .find('.detailed-screening__cta.cta--primary-small[href*="veezi.com/purchase/"]')
        .first()
        .attr("href")
        ?.trim() ?? "";
    const ticketId = getTicketId(ticketUrl);
    if (
      !title ||
      !filmId ||
      !detailUrl.startsWith("https://www.roxycinemanewyork.com/screenings/") ||
      !ticketId
    ) {
      warnings.push(`screenings[${index}] lacks a trustworthy title, detail URL, or ticket ID.`);
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

    const event = extractEventNote(
      title,
      cleanText(card.find(".detailed-screening__copy").first().text()),
      localDate,
    );
    showings.push({
      id: `roxy-cinema-${ticketId}`,
      cinemaId: "roxy-cinema",
      filmId,
      startsAt,
      localDate,
      localTime: startsAt.slice(11, 16),
      format: getFormat(title),
      eventType: event.eventType,
      eventNote: event.eventNote,
      detailUrl,
      ticketUrl,
      availability: "unknown",
      sourceUrl: ROXY_SOURCE_URL,
      fetchedAt: options.fetchedAt,
      extractionStatus: "verified",
    });
  });

  if (showings.length === 0) {
    warnings.push("Official page contained no publishable showings; manual review required.");
  }
  return {
    cinemaId: "roxy-cinema",
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

export async function fetchRoxyCinemaSchedule(
  windowStart: string,
  windowEnd: string,
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const baseOptions = { fetchedAt, contentHash: "", windowStart, windowEnd };
  try {
    const response = await fetch(ROXY_SOURCE_URL, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "NYC-Repertory-Cinema-Week/0.1 (official schedule ingestion)",
      },
    });
    const html = await response.text();
    const contentHash = await sha256(html);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseRoxyCinemaHtml(html, { ...baseOptions, contentHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cinemaId: "roxy-cinema",
      films: [],
      showings: [],
      snapshot: snapshot(baseOptions, "failed", message),
      warnings: [],
    };
  }
}
