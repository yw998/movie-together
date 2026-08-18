import { describe, expect, it } from "vitest";
import { synchronizePublishedDescriptions } from "./description-sync";
import type { ScheduleData } from "../types/schedule";

const schedule: ScheduleData = {
  metadata: {
    timezone: "America/New_York",
    windowStart: "2026-08-18",
    windowEnd: "2026-08-24",
    refreshedLocalDate: "2026-08-18",
    provenanceNote: "Approved facts.",
  },
  cinemas: [{
    id: "film-forum", name: "Film Forum", officialUrl: "https://filmforum.org",
    scheduleUrl: "https://filmforum.org/now_playing", timezone: "America/New_York",
    enabled: true, color: "#000000",
  }],
  films: [{
    id: "film-a", canonicalTitle: "Film A", displayTitle: "Film A", year: null,
    director: null, runtimeMinutes: null, descriptionZh: "中文简介已经存在。",
    descriptionEn: null, descriptionSource: "https://filmforum.org/film-a",
  }],
  showings: [{
    id: "showing-a", cinemaId: "film-forum", filmId: "film-a",
    startsAt: "2026-08-18T19:00:00-04:00", localDate: "2026-08-18", localTime: "19:00",
    format: null, eventType: "standard", eventNote: null,
    detailUrl: "https://filmforum.org/film-a", ticketUrl: null, availability: "unknown",
    sourceUrl: "https://filmforum.org/film-a", fetchedAt: "2026-08-18T12:00:00.000Z",
    extractionStatus: "verified",
  }],
};

describe("published description synchronization", () => {
  it("adds database descriptions without changing schedule facts", () => {
    const result = synchronizePublishedDescriptions(schedule, [{
      id: "film-a",
      descriptionZh: "更新后的中文简介。",
      descriptionEn: "An English description grounded in the official film page.",
      descriptionSource: "https://filmforum.org/film-a",
    }]);

    expect(result.schedule.films[0]).toMatchObject({
      descriptionZh: "更新后的中文简介。",
      descriptionEn: "An English description grounded in the official film page.",
    });
    expect(result.schedule.metadata).toBe(schedule.metadata);
    expect(result.schedule.cinemas).toBe(schedule.cinemas);
    expect(result.schedule.showings).toBe(schedule.showings);
    expect(result.stats).toEqual({ matchedFilms: 1, changedFilms: 1, addedChinese: 0, addedEnglish: 1 });
  });

  it("rejects an unsourced database description", () => {
    expect(() => synchronizePublishedDescriptions({
      ...schedule,
      films: [{ ...schedule.films[0], descriptionZh: null, descriptionSource: null }],
    }, [{
      id: "film-a", descriptionZh: null, descriptionEn: "Unsourced copy", descriptionSource: null,
    }])).toThrow("have no evidence source");
  });

  it("removes a published description that the database has invalidated", () => {
    const result = synchronizePublishedDescriptions({
      ...schedule,
      films: [{ ...schedule.films[0], descriptionEn: "An obsolete English description." }],
    }, [{
      id: "film-a",
      descriptionZh: "中文简介已经存在。",
      descriptionEn: null,
      descriptionSource: "https://filmforum.org/film-a",
    }]);
    expect(result.schedule.films[0].descriptionEn).toBeNull();
  });
});
