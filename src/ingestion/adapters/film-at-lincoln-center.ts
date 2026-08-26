import type { Film, Showing } from "../../types/schedule";
import type { AdapterResult, SourceSnapshot } from "../types";

export const FILM_LINC_SHOWTIMES_URL = "https://api.filmlinc.org/showtimes";
export const FILM_LINC_GRAPHQL_URL = "https://api.filmlinc.org/wordpress/graphql";
export const FILM_LINC_NOW_PLAYING_URL = "https://www.filmlinc.org/now-playing/";
export const FILM_LINC_PARSER_VERSION = "film-linc-api-graphql-v2";

type Showtime = {
  id?: unknown;
  productionSeasonId?: unknown;
  date?: unknown;
  time?: unknown;
  dateTimeET?: unknown;
  venue?: unknown;
  available?: unknown;
  ticketsUrl?: unknown;
  openCaptions?: unknown;
  freeEvent?: unknown;
  status?: unknown;
  description?: unknown;
};

type ShowtimeFilm = {
  id?: unknown;
  title?: unknown;
  slug?: unknown;
  showtimes?: unknown;
};

type ShowtimePayload = { films?: unknown };

export type FilmLincDetails = {
  title: string;
  excerpt: string | null;
  director: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  formats: string[];
  accessibility: string[];
  specialEvents: Array<{
    tessituraId: string;
    promoShort: string[];
    promoTooltip: string | null;
  }>;
};

type ParseOptions = {
  fetchedAt: string;
  contentHash: string;
  windowStart: string;
  windowEnd: string;
};

function snapshot(
  options: ParseOptions,
  result: SourceSnapshot["result"],
  error: string | null,
): SourceSnapshot {
  return {
    cinemaId: "film-at-lincoln-center",
    fetchedAt: options.fetchedAt,
    sourceUrl: FILM_LINC_SHOWTIMES_URL,
    contentHash: options.contentHash,
    parserVersion: FILM_LINC_PARSER_VERSION,
    result,
    error,
  };
}

function validOffsetIso(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value) &&
    !Number.isNaN(new Date(value).getTime());
}

function formatFor(details: FilmLincDetails): Showing["format"] {
  const values = details.formats.join(" ");
  if (/\b70mm\b/i.test(values)) return "70mm";
  if (/\b35mm\b/i.test(values)) return "35mm";
  if (/\b16mm\b/i.test(values)) return "16mm";
  if (/\b4K\s+DCP\b/i.test(values)) return "4K DCP";
  if (/\bDCP\b/i.test(values)) return "DCP";
  return null;
}

function availability(status: unknown, available: unknown): Showing["availability"] {
  if (status === "standby" || status === "sold_out") return "sold_out";
  if ((status === "available" || status === "limited") && available === true) return "available";
  return "unknown";
}

function isVerifiedGalleryEvent(showing: Showtime): boolean {
  return showing.freeEvent === true &&
    showing.venue === "Furman Gallery" &&
    typeof showing.description === "string" &&
    showing.description.trim().length > 0;
}

function eventFacts(
  showingId: string,
  openCaptions: boolean,
  details: FilmLincDetails,
): Pick<Showing, "eventType" | "eventNote"> {
  const matching = details.specialEvents.filter((event) =>
    event.tessituraId.split(",").map((id) => id.trim()).includes(showingId),
  );
  const codes = new Set(matching.flatMap((event) => event.promoShort.map((code) => code.toLowerCase())));
  const notes = matching.flatMap((event) => event.promoTooltip ? [event.promoTooltip] : []);
  if (openCaptions) notes.push("Open Captions");
  let eventType: Showing["eventType"] = "standard";
  if (codes.has("qa")) eventType = "qa";
  else if (codes.has("intro")) eventType = "intro";
  else if (openCaptions) eventType = "open_caption";
  else if (codes.size > 0) eventType = "other";
  return { eventType, eventNote: [...new Set(notes)].join(" · ") || null };
}

export function parseFilmLincPayload(
  payload: unknown,
  detailsBySlug: ReadonlyMap<string, FilmLincDetails>,
  options: ParseOptions,
): AdapterResult {
  const warnings: string[] = [];
  const films: Film[] = [];
  const showings: Showing[] = [];
  const rawFilms = (payload as ShowtimePayload | null)?.films;
  if (!Array.isArray(rawFilms)) {
    return {
      cinemaId: "film-at-lincoln-center",
      films: [],
      showings: [],
      snapshot: snapshot(options, "failed", "Official response has no films array."),
      warnings: [],
    };
  }

  rawFilms.forEach((raw, filmIndex) => {
    const item = raw as ShowtimeFilm;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const slug = typeof item.slug === "string" ? item.slug.trim() : "";
    const productionId = typeof item.id === "string" ? item.id : "";
    const rawShowings = Array.isArray(item.showtimes) ? item.showtimes as Showtime[] : [];
    const inWindow = rawShowings.filter((showing) =>
      typeof showing.date === "string" &&
      showing.date >= options.windowStart &&
      showing.date <= options.windowEnd,
    );
    if (inWindow.length === 0) return;
    if (!title || !slug || !/^\d+$/.test(productionId) || !/^[a-z0-9-]+$/.test(slug)) {
      warnings.push(`films[${filmIndex}] has no trustworthy title, slug, or production ID.`);
      return;
    }
    // Passes are products rather than screenings and use the API's synthetic Pass Venue.
    if (inWindow.every((showing) => showing.venue === "Pass Venue")) return;
    const details = detailsBySlug.get(slug);
    const isGalleryEvent = !details && inWindow.every(isVerifiedGalleryEvent);
    if (!details && !isGalleryEvent) {
      warnings.push(`films[${filmIndex}] (${slug}) has no official GraphQL details.`);
      return;
    }
    const detailUrl = details
      ? `https://www.filmlinc.org/films/${slug}/`
      : FILM_LINC_NOW_PLAYING_URL;
    films.push({
      id: slug,
      canonicalTitle: details?.title.trim() || title,
      displayTitle: details?.title.trim() || title,
      year: details?.year ?? null,
      director: details?.director ?? null,
      runtimeMinutes: details?.runtimeMinutes ?? null,
        descriptionZh: null,
        descriptionEn: null,
      descriptionSource: null,
    });

    inWindow.forEach((showing, showingIndex) => {
      const id = typeof showing.id === "string" ? showing.id : "";
      const localDate = typeof showing.date === "string" ? showing.date : "";
      const ticketsUrl = typeof showing.ticketsUrl === "string" ? showing.ticketsUrl : "";
      if (
        !/^\d+$/.test(id) ||
        showing.productionSeasonId !== productionId ||
        !validOffsetIso(showing.dateTimeET) ||
        showing.dateTimeET.slice(0, 10) !== localDate ||
        !ticketsUrl.startsWith(`https://purchase.filmlinc.org/${productionId}/${id}`)
      ) {
        warnings.push(`films[${filmIndex}].showtimes[${showingIndex}] has inconsistent official IDs, time, or ticket URL.`);
        return;
      }
      const localTime = showing.dateTimeET.slice(11, 16);
      const facts = details
        ? eventFacts(id, showing.openCaptions === true, details)
        : {
            eventType: "other" as const,
            eventNote: String(showing.venue),
          };
      const currentAvailability = availability(showing.status, showing.available);
      const notes = [facts.eventNote];
      if (showing.status === "standby") notes.push("Standby Only");
      if (showing.freeEvent === true) notes.push("Free Event");
      showings.push({
        id: `film-at-lincoln-center-${id}`,
        cinemaId: "film-at-lincoln-center",
        filmId: slug,
        startsAt: showing.dateTimeET,
        localDate,
        localTime,
        format: details ? formatFor(details) : null,
        eventType: facts.eventType,
        eventNote: [...new Set(notes.filter((note): note is string => Boolean(note)))].join(" · ") || null,
        detailUrl,
        ticketUrl: ticketsUrl,
        availability: currentAvailability,
        sourceUrl: FILM_LINC_SHOWTIMES_URL,
        fetchedAt: options.fetchedAt,
        extractionStatus: "verified",
      });
    });
  });

  if (showings.length === 0) warnings.push("Official API contained no publishable showings; manual review required.");
  const referenced = new Set(showings.map((showing) => showing.filmId));
  return {
    cinemaId: "film-at-lincoln-center",
    films: films.filter((film) => referenced.has(film.id)),
    showings,
    snapshot: snapshot(
      options,
      warnings.length === 0 ? "success" : "partial",
      warnings.length === 0 ? null : `${warnings.length} parser warning(s).`,
    ),
    warnings,
  };
}

function plainText(html: string | null): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, " ").replace(/&(?:#8217|rsquo);/g, "’").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return text || null;
}

async function fetchFilmDetails(slug: string): Promise<FilmLincDetails | null> {
  const response = await fetch(FILM_LINC_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `query FilmDetails($id: ID!) {
        film(id: $id, idType: URI) {
          title excerpt
          filmDetails {
            directors { name }
            year runningTime presentationFormats accessibility productionSeasonIds
            specialEvents { tessituraId promoShort promoTooltip }
          }
        }
      }`,
      variables: { id: `/films/${slug}/` },
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as {
    data?: { film?: {
      title?: unknown;
      excerpt?: unknown;
      filmDetails?: {
        directors?: Array<{ name?: unknown }>;
        year?: unknown;
        runningTime?: unknown;
        presentationFormats?: unknown;
        accessibility?: unknown;
        specialEvents?: Array<{ tessituraId?: unknown; promoShort?: unknown; promoTooltip?: unknown }>;
      };
    } };
  };
  const film = payload.data?.film;
  const details = film?.filmDetails;
  if (!film || !details || typeof film.title !== "string") return null;
  const year = typeof details.year === "string" && /^\d{4}$/.test(details.year) ? Number(details.year) : null;
  const runtimeMinutes = typeof details.runningTime === "string" && /^\d+$/.test(details.runningTime)
    ? Number(details.runningTime) : null;
  return {
    title: film.title,
    excerpt: plainText(typeof film.excerpt === "string" ? film.excerpt : null),
    director: details.directors?.map((director) => typeof director.name === "string" ? director.name.trim() : "").filter(Boolean).join(", ") || null,
    year,
    runtimeMinutes,
    formats: Array.isArray(details.presentationFormats) ? details.presentationFormats.filter((value): value is string => typeof value === "string") : [],
    accessibility: Array.isArray(details.accessibility) ? details.accessibility.filter((value): value is string => typeof value === "string") : [],
    specialEvents: Array.isArray(details.specialEvents) ? details.specialEvents.flatMap((event) => {
      if (typeof event.tessituraId !== "string") return [];
      return [{
        tessituraId: event.tessituraId,
        promoShort: Array.isArray(event.promoShort) ? event.promoShort.filter((value): value is string => typeof value === "string") : [],
        promoTooltip: typeof event.promoTooltip === "string" ? event.promoTooltip.trim() : null,
      }];
    }) : [],
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchFilmAtLincolnCenterSchedule(windowStart: string, windowEnd: string): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const baseOptions = { fetchedAt, contentHash: "", windowStart, windowEnd };
  try {
    const response = await fetch(FILM_LINC_SHOWTIMES_URL, {
      headers: { Accept: "application/json", "User-Agent": "NYC-Repertory-Cinema-Week/0.1 (official schedule ingestion)" },
    });
    const body = await response.text();
    const contentHash = await sha256(body);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = JSON.parse(body) as ShowtimePayload;
    const rawFilms = Array.isArray(payload.films) ? payload.films as ShowtimeFilm[] : [];
    const slugs = rawFilms.filter((film) => Array.isArray(film.showtimes) && (film.showtimes as Showtime[]).some((showing) =>
      typeof showing.date === "string" && showing.date >= windowStart && showing.date <= windowEnd && showing.venue !== "Pass Venue",
    )).map((film) => typeof film.slug === "string" ? film.slug : "").filter(Boolean);
    const detailPairs = await Promise.all([...new Set(slugs)].map(async (slug) => [slug, await fetchFilmDetails(slug)] as const));
    const detailsBySlug = new Map(detailPairs.filter((pair): pair is readonly [string, FilmLincDetails] => pair[1] !== null));
    return parseFilmLincPayload(payload, detailsBySlug, { ...baseOptions, contentHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cinemaId: "film-at-lincoln-center",
      films: [],
      showings: [],
      snapshot: snapshot(baseOptions, "failed", message),
      warnings: [],
    };
  }
}
