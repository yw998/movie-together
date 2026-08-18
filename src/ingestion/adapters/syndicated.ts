import { load } from "cheerio";
import type { Film, Showing } from "../../types/schedule";
import type { AdapterResult, SourceSnapshot } from "../types";

export const SYNDICATED_SITE_TOKEN = "dxdq5wzbef6bz2sjqt83ytzn1c";
export const SYNDICATED_SOURCE_URL =
  `https://ticketing.useast.veezi.com/sessions/?siteToken=${SYNDICATED_SITE_TOKEN}`;
export const SYNDICATED_PARSER_VERSION = "syndicated-veezi-html-jsonld-v1";

type ParseOptions = {
  fetchedAt: string;
  contentHash: string;
  windowStart: string;
  windowEnd: string;
};

type JsonRecord = Record<string, unknown>;

type OfficialEvent = {
  name: string;
  startsAt: string;
  durationMinutes: number | null;
  ticketUrl: string;
  sessionId: string;
};

type FilmCard = {
  filmId: string;
  title: string;
  description: string;
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? cleanText(value) : "";
}

function snapshot(
  options: ParseOptions,
  result: SourceSnapshot["result"],
  error: string | null,
): SourceSnapshot {
  return {
    cinemaId: "syndicated",
    fetchedAt: options.fetchedAt,
    sourceUrl: SYNDICATED_SOURCE_URL,
    contentHash: options.contentHash,
    parserVersion: SYNDICATED_PARSER_VERSION,
    result,
    error,
  };
}

function ticketIdentity(value: string): { url: string; sessionId: string } | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/purchase\/(\d+)$/);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "ticketing.useast.veezi.com" ||
      url.searchParams.get("siteToken") !== SYNDICATED_SITE_TOKEN ||
      !match
    ) {
      return null;
    }
    return { url: url.toString(), sessionId: match[1] };
  } catch {
    return null;
  }
}

function validOffsetIso(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function durationMinutes(value: string): number | null {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function eventKey(title: string, monthDay: string, localTime: string): string {
  return `${cleanText(title).toLocaleLowerCase()}|${monthDay}|${localTime}`;
}

function parseMonthDay(value: string): string | null {
  const match = value.match(/\b(\d{1,2}),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  if (!match) return null;
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const month = months.indexOf(match[2].toLocaleLowerCase()) + 1;
  return `${String(month).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function parseDisplayTime(value: string): string | null {
  const match = cleanText(value).match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLocaleLowerCase() === "pm") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function parseJsonScripts(html: string): unknown[] {
  const $ = load(html);
  const values: unknown[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      values.push(JSON.parse($(element).text()) as unknown);
    } catch {
      values.push(null);
    }
  });
  return values;
}

function officialEvents(values: readonly unknown[], warnings: string[]): OfficialEvent[] | null {
  const theater = values
    .map(record)
    .find((value) => value?.["@type"] === "MovieTheater");
  if (
    !theater ||
    text(theater.name) !== "Syndicated Bar Theater Kitchen" ||
    text(theater.legalName) !== "Syndicated Bar Theater Kitchen" ||
    !text(record(theater.location)?.address).includes("40 Bogart St")
  ) {
    return null;
  }

  const rawEvents = values.find((value) =>
    Array.isArray(value) && value.some((item) => record(item)?.["@type"] === "VisualArtsEvent"),
  );
  if (!Array.isArray(rawEvents)) return null;

  const events: OfficialEvent[] = [];
  const seen = new Set<string>();
  rawEvents.forEach((raw, index) => {
    const item = record(raw);
    const name = text(item?.name);
    const startsAt = text(item?.startDate);
    const ticket = ticketIdentity(text(item?.url));
    const location = record(item?.location);
    const duration = durationMinutes(text(item?.duration));
    if (
      item?.["@type"] !== "VisualArtsEvent" ||
      !name ||
      !validOffsetIso(startsAt) ||
      !ticket ||
      text(location?.name) !== "Syndicated Bar Theater Kitchen" ||
      !text(location?.address).includes("40 Bogart St")
    ) {
      warnings.push(`jsonLd.events[${index}] has invalid identity, time, location, or ticket evidence.`);
      return;
    }
    if (duration === null) {
      warnings.push(`jsonLd.events[${index}] has an unsupported duration.`);
    }
    if (seen.has(ticket.sessionId)) {
      warnings.push(`Duplicate official session ID ${ticket.sessionId}.`);
      return;
    }
    seen.add(ticket.sessionId);
    events.push({
      name,
      startsAt,
      durationMinutes: duration,
      ticketUrl: ticket.url,
      sessionId: ticket.sessionId,
    });
  });
  return events;
}

function filmCards(html: string, warnings: string[]): Map<string, FilmCard> {
  const $ = load(html);
  const cards = new Map<string, FilmCard>();
  $("#sessionsByFilmConent .film[id]").each((index, element) => {
    const card = $(element);
    const upstreamId = cleanText(card.attr("id") ?? "");
    const nameId = cleanText(card.attr("name") ?? "");
    const title = cleanText(card.find(".title").first().text());
    if (!/^ST\d+$/.test(upstreamId) || upstreamId !== nameId || !title) {
      warnings.push(`filmCards[${index}] has no trustworthy film ID or title.`);
      return;
    }
    if (cards.has(title)) {
      warnings.push(`Official film cards contain a duplicate title: ${title}.`);
      return;
    }
    cards.set(title, {
      filmId: `syndicated-${upstreamId}`,
      title,
      description: cleanText(card.find(".film-desc").first().text()),
    });
  });
  return cards;
}

function htmlAvailability(html: string, warnings: string[]): Map<string, Showing["availability"]> {
  const $ = load(html);
  const availability = new Map<string, Showing["availability"]>();
  $("#sessionsByDateConent > .date").each((dateIndex, dateElement) => {
    const date = $(dateElement);
    const monthDay = parseMonthDay(date.children(".date-title").first().text());
    if (!monthDay) {
      warnings.push(`scheduleDates[${dateIndex}] has an unrecognized official date.`);
      return;
    }
    date.children(".film").each((filmIndex, filmElement) => {
      const film = $(filmElement);
      const title = cleanText(film.find(".title").first().text());
      film.find(".session-times > li").each((timeIndex, timeElement) => {
        const row = $(timeElement);
        const localTime = parseDisplayTime(row.find("time").first().text());
        if (!title || !localTime) {
          warnings.push(`scheduleDates[${dateIndex}].films[${filmIndex}].times[${timeIndex}] is incomplete.`);
          return;
        }
        const key = eventKey(title, monthDay, localTime);
        if (availability.has(key)) {
          warnings.push(`Official HTML has a duplicate date/time row for ${title} ${monthDay} ${localTime}.`);
          return;
        }
        availability.set(
          key,
          row.find(".tickets-sold-out").length > 0 ? "sold_out" : "available",
        );
      });
    });
  });
  return availability;
}

function openCaptionFacts(
  card: FilmCard,
  events: readonly OfficialEvent[],
  warnings: string[],
  windowStart: string,
  windowEnd: string,
): Map<string, string> {
  const facts = new Map<string, string>();
  if (!/open captions?/i.test(card.description)) return facts;
  const note = card.description.match(/[^.!?]*open captions?[^.!?]*(?:[.!?]|$)/i)?.[0];
  if (!note) {
    warnings.push(`${card.filmId} mentions open captions without a parseable official note.`);
    return facts;
  }
  const matches = [...note.matchAll(/(\d{1,2})\/(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)/gi)];
  if (matches.length === 0) {
    warnings.push(`${card.filmId} has an open-caption note without a dated time.`);
    return facts;
  }
  for (const match of matches) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const years = new Set([Number(windowStart.slice(0, 4)), Number(windowEnd.slice(0, 4))]);
    const possibleDates = [...years]
      .map((year) => {
        const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const parsed = new Date(`${value}T12:00:00Z`);
        return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day
          ? value
          : null;
      })
      .filter((value): value is string => value !== null);
    if (possibleDates.length === 0) {
      warnings.push(`${card.filmId} has an open-caption note with an invalid date.`);
      continue;
    }
    if (!possibleDates.some((value) => value >= windowStart && value <= windowEnd)) {
      continue;
    }
    let hour = Number(match[3]) % 12;
    if (match[5].toLocaleLowerCase() === "pm") hour += 12;
    const monthDay = `${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
    const localTime = `${String(hour).padStart(2, "0")}:${match[4] ?? "00"}`;
    const candidates = events.filter((event) =>
      event.name === card.title &&
      event.startsAt.slice(5, 10) === monthDay &&
      event.startsAt.slice(11, 16) === localTime,
    );
    if (candidates.length !== 1) {
      warnings.push(`${card.filmId} open-caption note matched ${candidates.length} official sessions.`);
      continue;
    }
    facts.set(candidates[0].sessionId, cleanText(note));
  }
  return facts;
}

function specialEventNote(card: FilmCard): string | null {
  const sentence = card.description.match(
    /[^.!?]*(?:interactive (?:movie )?party|watch party)[^.!?]*(?:[.!?]|$)/i,
  )?.[0];
  if (sentence) return cleanText(sentence);
  return null;
}

function runtimeFor(
  title: string,
  events: readonly OfficialEvent[],
  warnings: string[],
): number | null {
  const values = new Set(
    events
      .filter((event) => event.name === title && event.durationMinutes !== null)
      .map((event) => event.durationMinutes as number),
  );
  if (values.size > 1) {
    warnings.push(`Official events disagree on runtime for ${title}.`);
    return null;
  }
  return values.values().next().value ?? null;
}

export function parseSyndicatedHtml(
  html: string,
  options: ParseOptions,
): AdapterResult {
  const warnings: string[] = [];
  const events = officialEvents(parseJsonScripts(html), warnings);
  if (!events) {
    return {
      cinemaId: "syndicated",
      films: [],
      showings: [],
      snapshot: snapshot(options, "failed", "Official theater identity or JSON-LD events were not found."),
      warnings,
    };
  }

  const cards = filmCards(html, warnings);
  const availability = htmlAvailability(html, warnings);
  if (events.length !== availability.size) {
    warnings.push(`Official JSON-LD/HTML showing count mismatch (${events.length}/${availability.size}).`);
  }

  const inWindow = events.filter((event) => {
    const localDate = event.startsAt.slice(0, 10);
    return localDate >= options.windowStart && localDate <= options.windowEnd;
  });
  const captionFacts = new Map<string, string>();
  for (const card of cards.values()) {
    for (const [sessionId, note] of openCaptionFacts(
      card, events, warnings, options.windowStart, options.windowEnd,
    )) {
      captionFacts.set(sessionId, note);
    }
  }

  const filmsById = new Map<string, Film>();
  const showings: Showing[] = [];
  for (const event of inWindow) {
    const card = cards.get(event.name);
    if (!card) {
      warnings.push(`Official session ${event.sessionId} has no matching stable film card.`);
      continue;
    }
    if (!filmsById.has(card.filmId)) {
      filmsById.set(card.filmId, {
        id: card.filmId,
        canonicalTitle: card.title,
        displayTitle: card.title,
        year: null,
        director: null,
        runtimeMinutes: runtimeFor(card.title, events, warnings),
        descriptionZh: null,
        descriptionEn: null,
        descriptionSource: null,
      });
    }
    const localDate = event.startsAt.slice(0, 10);
    const localTime = event.startsAt.slice(11, 16);
    const status = availability.get(eventKey(event.name, localDate.slice(5), localTime));
    if (!status) {
      warnings.push(`Official session ${event.sessionId} has no matching HTML availability row.`);
    }
    const captionNote = captionFacts.get(event.sessionId);
    const activityNote = specialEventNote(card);
    showings.push({
      id: `syndicated-${event.sessionId}`,
      cinemaId: "syndicated",
      filmId: card.filmId,
      startsAt: event.startsAt,
      localDate,
      localTime,
      format: null,
      eventType: captionNote ? "open_caption" : activityNote ? "other" : "standard",
      eventNote: captionNote ?? activityNote,
      detailUrl: SYNDICATED_SOURCE_URL,
      ticketUrl: event.ticketUrl,
      availability: status ?? "unknown",
      sourceUrl: SYNDICATED_SOURCE_URL,
      fetchedAt: options.fetchedAt,
      extractionStatus: "verified",
    });
  }

  if (showings.length === 0) {
    warnings.push("Official source contained no publishable in-window showings; manual review required.");
  }
  return {
    cinemaId: "syndicated",
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchSyndicatedSchedule(
  windowStart: string,
  windowEnd: string,
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const baseOptions = { fetchedAt, contentHash: "", windowStart, windowEnd };
  try {
    const response = await fetch(SYNDICATED_SOURCE_URL, {
      headers: {
        Accept: "text/html",
        "User-Agent": "NYC-Repertory-Cinema-Week/0.1 (official schedule ingestion)",
      },
    });
    const html = await response.text();
    const contentHash = await sha256(html);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseSyndicatedHtml(html, { ...baseOptions, contentHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cinemaId: "syndicated",
      films: [],
      showings: [],
      snapshot: snapshot(baseOptions, "failed", message),
      warnings: [],
    };
  }
}
