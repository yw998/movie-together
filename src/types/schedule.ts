export const NEW_YORK_TIMEZONE = "America/New_York" as const;

export type Cinema = {
  id: string;
  name: string;
  officialUrl: string;
  scheduleUrl: string;
  timezone: typeof NEW_YORK_TIMEZONE;
  enabled: boolean;
  color: string;
};

export type Film = {
  id: string;
  canonicalTitle: string;
  displayTitle: string;
  year: number | null;
  director: string | null;
  runtimeMinutes: number | null;
  descriptionZh: string | null;
  /** English copy may be absent while an older approved dataset is being backfilled. */
  descriptionEn: string | null;
  descriptionSource: string | null;
};

export type Showing = {
  id: string;

  /** Exact database publication key paired with `id` for interactive writes. */
  storageWindowStart?: string;
  cinemaId: string;
  filmId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  format: "35mm" | "70mm" | "16mm" | "DCP" | "4K DCP" | null;
  eventType:
    | "standard"
    | "qa"
    | "intro"
    | "members_only"
    | "open_caption"
    | "other";
  eventNote: string | null;
  detailUrl: string;
  ticketUrl: string | null;
  availability: "available" | "sold_out" | "unknown";
  sourceUrl: string;
  fetchedAt: string | null;
  extractionStatus: "verified" | "needs_review" | "manual";
};

export type ScheduleMetadata = {
  timezone: typeof NEW_YORK_TIMEZONE;
  windowStart: string;
  windowEnd: string;
  refreshedLocalDate: string;
  provenanceNote: string;
  unavailableCinemaDates?: Array<{
    cinemaId: string;
    localDate: string;
    reason: "feed_unavailable";
  }>;
};

export type ScheduleData = {
  metadata: ScheduleMetadata;
  cinemas: Cinema[];
  films: Film[];
  showings: Showing[];
};

export type PublishedShowing = Showing & { storageWindowStart: string };
export type PublishedScheduleData = Omit<ScheduleData, "showings"> & {
  showings: PublishedShowing[];
};
