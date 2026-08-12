import { localPartsAtInstant } from "../../lib/timezone";
import type { Film, Showing } from "../../types/schedule";
import type { AdapterResult, SourceSnapshot } from "../types";

export const PARIS_SOURCE_URL = "https://www.paristheaternyc.com/";
export const PARIS_API_URL = "https://digital-api.paristheaternyc.com/ocapi/v1";
export const PARIS_CMS_URL = "https://cms.ntflxthtrs.com/api/films";
export const PARIS_PARSER_VERSION = "paris-digital-api-cms-v1";

type ParseOptions = {
  fetchedAt: string;
  contentHash: string;
  windowStart: string;
  windowEnd: string;
};

type ClientConfig = {
  tokenUrl: string;
  username: string;
  password: string;
  clientId: string;
  scope: string;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringAfterProperty(source: string, property: string): string {
  const key = escapeRegExp(property);
  const match = source.match(
    new RegExp(`(?:${key}|["']${key}["'])\\s*:\\s*["']([^"']+)["']`),
  );
  return match?.[1] ?? "";
}

function appendedFormValue(source: string, property: string): string {
  const key = escapeRegExp(property);
  const match = source.match(
    new RegExp(`\\.append\\(["']${key}["']\\s*,\\s*["']["']\\.concat\\(["']([^"']+)["']\\)\\)`),
  );
  return match?.[1] ?? "";
}

/** Extracts only in-memory client configuration from the theater's current JS. */
export function discoverParisClientConfig(source: string): ClientConfig | null {
  // Next may serialize the module source inside an RSC string, escaping every
  // quote. Normalize that representation before matching named form fields.
  const normalized = source.replace(/\\"/g, '"').replace(/\\\//g, "/");
  const tokenUrl =
    normalized.match(/https:\/\/auth\.moviexchange\.com\/connect\/token/)?.[0] ?? "";
  const username = stringAfterProperty(normalized, "username") || appendedFormValue(normalized, "username");
  const password = stringAfterProperty(normalized, "password") || appendedFormValue(normalized, "password");
  const clientId = stringAfterProperty(normalized, "client_id") || appendedFormValue(normalized, "client_id");
  const scope = stringAfterProperty(normalized, "scope");
  if (!tokenUrl || !username || !password || !clientId) return null;
  return { tokenUrl, username, password, clientId, scope };
}

function normalizeIso(value: string): string | null {
  if (!/[+-]\d{2}:?\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    return null;
  }
  return value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

function localDateTime(startsAt: string): { date: string; time: string } {
  const parts = localPartsAtInstant(new Date(startsAt));
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

function getFormat(value: string): Showing["format"] {
  if (/\b70mm\b/i.test(value)) return "70mm";
  if (/\b35mm\b/i.test(value)) return "35mm";
  if (/\b16mm\b/i.test(value)) return "16mm";
  if (/\b4K\s+DCP\b/i.test(value)) return "4K DCP";
  if (/\bDCP\b/i.test(value)) return "DCP";
  return null;
}

function getEventType(value: string): Showing["eventType"] {
  if (/Q\s*&\s*A/i.test(value)) return "qa";
  if (/members\s+only/i.test(value)) return "members_only";
  if (/\bintro(?:duction|duced)?\b/i.test(value)) return "intro";
  if (/open\s+captions?|\bOC\b/i.test(value)) return "open_caption";
  return value ? "other" : "standard";
}

function cmsAttributes(value: unknown): RecordValue | null {
  const item = record(value);
  if (!item) return null;
  return record(item.attributes) ?? item;
}

function relationItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const relation = record(value);
  return Array.isArray(relation?.data) ? relation.data : [];
}

function attributeLabels(payload: RecordValue): Map<string, string> {
  const result = new Map<string, string>();
  const relatedData = record(payload.relatedData);
  const attributes = relatedData?.attributes;
  const items = Array.isArray(attributes)
    ? attributes
    : record(attributes)
      ? Object.values(attributes as RecordValue)
      : [];
  for (const item of items) {
    const value = record(item);
    if (!value) continue;
    const id = text(value.id) || text(value.attributeId);
    const shortName = record(value.shortName);
    const name = record(value.name);
    const label = text(shortName?.text) || text(name?.text) || text(value.shortName) || text(value.name);
    if (id && label) result.set(id, label);
  }
  return result;
}

function snapshot(
  options: ParseOptions,
  result: SourceSnapshot["result"],
  error: string | null,
): SourceSnapshot {
  return {
    cinemaId: "paris-theater",
    fetchedAt: options.fetchedAt,
    sourceUrl: PARIS_SOURCE_URL,
    contentHash: options.contentHash,
    parserVersion: PARIS_PARSER_VERSION,
    result,
    error,
  };
}

export function parseParisPayloads(
  showtimePayloads: unknown[],
  cmsRecords: unknown[],
  options: ParseOptions,
): AdapterResult {
  const warnings: string[] = [];
  const cmsByVistaId = new Map<string, RecordValue>();
  for (const item of cmsRecords) {
    const attributes = cmsAttributes(item);
    if (!attributes) continue;
    const vistaId = text(attributes.VistaIDOverride) || text(attributes.VistaID);
    if (vistaId) cmsByVistaId.set(vistaId, attributes);
  }

  const filmsById = new Map<string, Film>();
  const showings: Showing[] = [];
  const seenIds = new Set<string>();
  let validPayloads = 0;

  showtimePayloads.forEach((rawPayload, payloadIndex) => {
    const payload = record(rawPayload);
    const items = payload && Array.isArray(payload.showtimes) ? payload.showtimes : null;
    if (!payload || !items) {
      warnings.push(`showtimePayloads[${payloadIndex}] has no showtimes array.`);
      return;
    }
    validPayloads += 1;
    const labels = attributeLabels(payload);

    items.forEach((rawItem, itemIndex) => {
      const item = record(rawItem);
      const schedule = record(item?.schedule);
      const showingId = text(item?.id);
      const vistaFilmId = text(item?.filmId);
      const startsAt = normalizeIso(text(schedule?.startsAt));
      const path = `showtimePayloads[${payloadIndex}].showtimes[${itemIndex}]`;
      if (!item || !showingId || !vistaFilmId || !startsAt) {
        warnings.push(`${path} has no trustworthy showing ID, film ID, or offset timestamp.`);
        return;
      }
      if (seenIds.has(showingId)) return;
      const local = localDateTime(startsAt);
      if (local.date < options.windowStart || local.date > options.windowEnd) return;
      const businessDate = text(schedule?.businessDate);
      if (businessDate && businessDate !== local.date) {
        warnings.push(`${path} business date does not match its New York timestamp.`);
        return;
      }

      const cms = cmsByVistaId.get(vistaFilmId);
      if (!cms) {
        warnings.push(`${path} film ${vistaFilmId} was not found in the official CMS.`);
        return;
      }
      const title = text(cms.FilmName) || text(cms.Title);
      const slug = text(cms.Slug);
      if (!title || !slug) {
        warnings.push(`${path} CMS record has no title or slug.`);
        return;
      }
      const filmId = slugify(title);
      const detailUrl = new URL(`/film/${encodeURIComponent(slug)}`, PARIS_SOURCE_URL).toString();
      if (!filmsById.has(filmId)) {
        const yearValue = Number(cms.Year);
        const runtimeValue = Number(cms.Runtime);
        filmsById.set(filmId, {
          id: filmId,
          canonicalTitle: title,
          displayTitle: title,
          year: Number.isInteger(yearValue) && yearValue > 1800 ? yearValue : null,
          director: text(cms.Director) || null,
          runtimeMinutes: Number.isInteger(runtimeValue) && runtimeValue > 0 ? runtimeValue : null,
          descriptionZh: null,
          descriptionSource: null,
        });
      }

      const attributeIds = Array.isArray(item.attributeIds)
        ? item.attributeIds.map(text).filter(Boolean)
        : [];
      const itemLabels = attributeIds.map((id) => labels.get(id)).filter((label): label is string => Boolean(label));
      const formatText = [text(cms.FilmFormat), ...itemLabels].join(" | ");
      const cmsEvents = relationItems(cms.events)
        .map(cmsAttributes)
        .filter((event): event is RecordValue => Boolean(event));
      const matchingEvents = cmsEvents.filter((event) => {
        const ticketId = text(event.TicketLink).match(/showtimes\/([^/]+)/)?.[1];
        return ticketId === showingId;
      });
      const notes = [
        ...matchingEvents.map((event) => text(event.EventName)),
        ...itemLabels,
      ].filter(Boolean);
      const eventNote = [...new Set(notes)].join(" | ") || null;
      const isSoldOut = item.isSoldOut === true;
      seenIds.add(showingId);
      showings.push({
        id: `paris-theater-${showingId}`,
        cinemaId: "paris-theater",
        filmId,
        startsAt,
        localDate: local.date,
        localTime: local.time,
        format: getFormat(formatText),
        eventType: getEventType(eventNote ?? ""),
        eventNote,
        detailUrl,
        ticketUrl: `https://tickets.paristheaternyc.com/order/showtimes/${encodeURIComponent(showingId)}/seats`,
        availability: isSoldOut ? "sold_out" : "available",
        sourceUrl: PARIS_SOURCE_URL,
        fetchedAt: options.fetchedAt,
        extractionStatus: "verified",
      });
    });
  });

  if (validPayloads === 0) {
    return {
      cinemaId: "paris-theater",
      films: [],
      showings: [],
      snapshot: snapshot(options, "failed", "Official API responses had no showtimes arrays."),
      warnings,
    };
  }
  if (showings.length === 0) {
    warnings.push("Official sources contained no publishable showings; manual review required.");
  }
  return {
    cinemaId: "paris-theater",
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

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (!Number.isNaN(cursor.getTime()) && cursor <= last && dates.length <= 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchCmsRecords(): Promise<{ records: unknown[]; evidence: string }> {
  const records: unknown[] = [];
  const bodies: string[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const url = new URL(PARIS_CMS_URL);
    url.searchParams.set("filters[Association][$containsi]", "Paris");
    url.searchParams.set("populate[events]", "*");
    url.searchParams.set("pagination[pageSize]", "200");
    url.searchParams.set("pagination[page]", String(page));
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.text();
    bodies.push(body);
    if (!response.ok) throw new Error(`CMS HTTP ${response.status}`);
    const payload = record(JSON.parse(body));
    if (!payload || !Array.isArray(payload.data)) throw new Error("CMS response has no data array.");
    records.push(...payload.data);
    const pagination = record(record(payload.meta)?.pagination);
    pageCount = Number(pagination?.pageCount) || 1;
    page += 1;
  } while (page <= pageCount && page <= 50);
  return { records, evidence: bodies.join("\n") };
}

export async function fetchParisTheaterSchedule(
  windowStart: string,
  windowEnd: string,
): Promise<AdapterResult> {
  const fetchedAt = new Date().toISOString();
  const baseOptions = { fetchedAt, contentHash: "", windowStart, windowEnd };
  try {
    const homepageResponse = await fetch(PARIS_SOURCE_URL, { headers: { Accept: "text/html" } });
    const homepage = await homepageResponse.text();
    if (!homepageResponse.ok) throw new Error(`Homepage HTTP ${homepageResponse.status}`);
    const serializedLayoutPath = homepage.match(/static\/chunks\/app\/layout-[a-z0-9.-]+\.js/)?.[0];
    const layoutPath = serializedLayoutPath ? `/_next/${serializedLayoutPath}` : null;
    if (!layoutPath) throw new Error("Current layout script was not discoverable.");
    const layoutResponse = await fetch(new URL(layoutPath, PARIS_SOURCE_URL));
    const layoutSource = await layoutResponse.text();
    if (!layoutResponse.ok) throw new Error(`Layout script HTTP ${layoutResponse.status}`);
    const config = discoverParisClientConfig(layoutSource);
    if (!config) throw new Error("Public client authentication contract changed; manual review required.");

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "password",
        username: config.username,
        password: config.password,
        client_id: config.clientId,
        ...(config.scope ? { scope: config.scope } : {}),
      }),
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) throw new Error(`Schedule authentication HTTP ${tokenResponse.status}`);
    const accessToken = text(record(JSON.parse(tokenBody))?.access_token);
    if (!accessToken) throw new Error("Schedule authentication returned no access token.");

    const showtimePayloads: unknown[] = [];
    const apiEvidence: string[] = [];
    for (const date of dateRange(windowStart, windowEnd)) {
      const response = await fetch(`${PARIS_API_URL}/showtimes/by-business-date/${date}?siteIds=2001`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      const body = await response.text();
      apiEvidence.push(body);
      if (!response.ok) throw new Error(`Showtimes ${date} HTTP ${response.status}`);
      showtimePayloads.push(JSON.parse(body));
    }
    const cms = await fetchCmsRecords();
    const contentHash = await sha256([homepage, layoutSource, ...apiEvidence, cms.evidence].join("\n"));
    return parseParisPayloads(showtimePayloads, cms.records, { ...baseOptions, contentHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      cinemaId: "paris-theater",
      films: [],
      showings: [],
      snapshot: snapshot(baseOptions, "failed", message),
      warnings: [],
    };
  }
}
