import { describe, expect, it } from "vitest";
import { deduplicateShowings, validateScheduleData } from "./schedule-validation";
import type { ScheduleData, Showing } from "../types/schedule";
import { NEW_YORK_TIMEZONE } from "../types/schedule";

const baseShowing: Showing = {
  id: "one",
  cinemaId: "cinema",
  filmId: "film",
  startsAt: "2026-08-11T19:00:00-04:00",
  localDate: "2026-08-11",
  localTime: "19:00",
  format: null,
  eventType: "standard",
  eventNote: null,
  detailUrl: "https://cinema.example/film",
  ticketUrl: null,
  availability: "unknown",
  sourceUrl: "https://cinema.example/film",
  fetchedAt: "2026-08-11T12:00:00-04:00",
  extractionStatus: "verified",
};

const baseData: ScheduleData = {
  metadata: {
    timezone: NEW_YORK_TIMEZONE,
    windowStart: "2026-08-11",
    windowEnd: "2026-08-17",
    refreshedLocalDate: "2026-08-11",
    provenanceNote: "test",
  },
  cinemas: [
    {
      id: "cinema",
      name: "Cinema",
      officialUrl: "https://cinema.example/",
      scheduleUrl: "https://cinema.example/calendar",
      timezone: NEW_YORK_TIMEZONE,
      enabled: true,
      color: "#000000",
    },
  ],
  films: [
    {
      id: "film",
      canonicalTitle: "Film",
      displayTitle: "Film",
      year: null,
      director: null,
      runtimeMinutes: null,
      descriptionZh: null,
      descriptionSource: null,
    },
  ],
  showings: [baseShowing],
  dateLabels: { "2026-08-11": "8/11" },
};

describe("schedule validation", () => {
  it("accepts a fresh, traceable showing", () => {
    const report = validateScheduleData(baseData, {
      now: new Date("2026-08-12T12:00:00-04:00"),
    });
    expect(report).toMatchObject({ errors: 0, warnings: 0, publishable: true });
  });

  it("accepts an official API subdomain when the cinema owns the parent domain", () => {
    const data: ScheduleData = {
      ...baseData,
      cinemas: [
        {
          ...baseData.cinemas[0],
          officialUrl: "https://filmlinc.org/",
          scheduleUrl: "https://www.filmlinc.org/now-playing/",
        },
      ],
      showings: [
        {
          ...baseShowing,
          sourceUrl: "https://api.filmlinc.org/showtimes",
        },
      ],
    };

    expect(validateScheduleData(data, {
      now: new Date("2026-08-11T16:00:00Z"),
    }).issues).toEqual([]);
  });

  it("reports mismatched local time, untrusted domains, and stale evidence", () => {
    const data: ScheduleData = {
      ...baseData,
      showings: [
        {
          ...baseShowing,
          localTime: "20:00",
          sourceUrl: "https://aggregator.example/film",
        },
      ],
    };
    const codes = validateScheduleData(data, {
      now: new Date("2026-08-20T12:00:00-04:00"),
      staleAfterHours: 72,
    }).issues.map((issue) => issue.code);
    expect(codes).toContain("local_time_mismatch");
    expect(codes).toContain("source_domain");
    expect(codes).toContain("stale_showing");
  });

  it("requires Chinese descriptions and provenance URLs to appear together", () => {
    const data: ScheduleData = {
      ...baseData,
      films: [{ ...baseData.films[0], descriptionZh: "中文简介" }],
    };
    expect(validateScheduleData(data).issues.map((issue) => issue.code)).toContain(
      "description_provenance",
    );
  });

  it("removes exact duplicates but preserves format and event variants", () => {
    const duplicate = { ...baseShowing, id: "duplicate" };
    const formatVariant: Showing = {
      ...baseShowing,
      id: "35mm",
      format: "35mm",
    };
    const eventVariant: Showing = {
      ...baseShowing,
      id: "qa",
      eventType: "qa",
      eventNote: "Q&A",
    };
    const result = deduplicateShowings([
      baseShowing,
      duplicate,
      formatVariant,
      eventVariant,
    ]);
    expect(result.showings.map((showing) => showing.id)).toEqual([
      "one",
      "35mm",
      "qa",
    ]);
    expect(result.duplicates).toHaveLength(1);
  });
});
