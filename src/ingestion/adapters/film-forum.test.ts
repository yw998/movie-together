import { describe, expect, it } from "vitest";
import { parseFilmForumPayload } from "./film-forum";

const options = {
  fetchedAt: "2026-08-11T17:30:00.000Z",
  contentHash: "abc123",
  windowStart: "2026-08-11",
  windowEnd: "2026-08-17",
};

describe("Film Forum official API adapter", () => {
  it("extracts explicit offset timestamps and ticket provenance", () => {
    const result = parseFilmForumPayload(
      {
        productions: [
          {
            productionTitle: "LATE FAME",
            productionSeasonActionUrl: "https://my.filmforum.org/late-fame",
            performances: [
              {
                id: 51727,
                iso8601DateString: "2026-08-12T12:15:00.0000000-04:00",
                performanceTitle: "LATE FAME",
                actionUrl: "https://my.filmforum.org/late-fame/51727",
                isPerformanceVisible: true,
                isOnSale: true,
                performanceStatusMessage: "",
              },
            ],
          },
        ],
      },
      options,
    );

    expect(result.snapshot).toMatchObject({
      result: "success",
      parserVersion: "film-forum-api-v3",
      contentHash: "abc123",
    });
    expect(result.showings).toEqual([
      expect.objectContaining({
        id: "film-forum-51727",
        startsAt: "2026-08-12T12:15:00.000-04:00",
        localDate: "2026-08-12",
        localTime: "12:15",
        detailUrl: "https://filmforum.org/film/late-fame",
        ticketUrl: "https://my.filmforum.org/late-fame/51727",
        eventType: "standard",
        eventNote: null,
        availability: "available",
        extractionStatus: "verified",
      }),
    ]);
  });

  it("preserves sold-out labels and excludes out-of-window records", () => {
    const result = parseFilmForumPayload(
      {
        productions: [
          {
            productionTitle: "SPECIAL FILM",
            productionSeasonActionUrl: "https://my.filmforum.org/special-film",
            performances: [
              {
                id: 1,
                iso8601DateString: "2026-08-11T19:00:00.0000000-04:00",
                performanceTitle: "SPECIAL FILM",
                actionUrl: "https://my.filmforum.org/special-film/1",
                isPerformanceVisible: true,
                isOnSale: false,
                performanceStatusMessage: "Sold Out",
              },
              {
                id: 2,
                iso8601DateString: "2026-08-18T19:00:00.0000000-04:00",
                performanceTitle: "SPECIAL FILM",
                actionUrl: "https://my.filmforum.org/special-film/2",
                isPerformanceVisible: true,
                isOnSale: true,
                performanceStatusMessage: "",
              },
            ],
          },
        ],
      },
      options,
    );
    expect(result.showings).toHaveLength(1);
    expect(result.showings[0]).toMatchObject({
      availability: "sold_out",
      eventType: "standard",
      eventNote: null,
    });
  });

  it("preserves distinct performance links and only marks explicit events", () => {
    const result = parseFilmForumPayload({
      productions: [{
        productionTitle: "ONE FILM",
        productionSeasonActionUrl: "https://my.filmforum.org/one-film",
        performances: [
          {
            id: 10,
            iso8601DateString: "2026-08-12T17:00:00.0000000-04:00",
            performanceTitle: "ONE FILM",
            actionUrl: "https://my.filmforum.org/one-film/10",
            isPerformanceVisible: true,
            isOnSale: true,
            performanceStatusMessage: "",
          },
          {
            id: 11,
            iso8601DateString: "2026-08-12T19:00:00.0000000-04:00",
            performanceTitle: "ONE FILM — Q&A with the director",
            actionUrl: "https://my.filmforum.org/one-film/11",
            isPerformanceVisible: true,
            isOnSale: true,
            performanceStatusMessage: "",
          },
        ],
      }],
    }, options);

    expect(result.snapshot.result).toBe("success");
    expect(result.showings).toEqual([
      expect.objectContaining({
        id: "film-forum-10",
        ticketUrl: "https://my.filmforum.org/one-film/10",
        eventType: "standard",
        eventNote: null,
      }),
      expect.objectContaining({
        id: "film-forum-11",
        ticketUrl: "https://my.filmforum.org/one-film/11",
        eventType: "qa",
        eventNote: "ONE FILM — Q&A with the director",
      }),
    ]);
  });

  it("fails visibly when the API shape changes", () => {
    const result = parseFilmForumPayload({ events: [] }, options);
    expect(result.snapshot).toMatchObject({
      result: "failed",
      error: "Response has no productions array.",
    });
    expect(result.showings).toEqual([]);
  });

  it("does not publish when the official detail path is untrustworthy", () => {
    const result = parseFilmForumPayload({
      productions: [{
        productionTitle: "ONE FILM",
        productionSeasonActionUrl: "https://example.com/one-film",
        performances: [{
          id: 10,
          iso8601DateString: "2026-08-12T17:00:00.0000000-04:00",
          performanceTitle: "ONE FILM",
          actionUrl: "https://my.filmforum.org/one-film/10",
          isPerformanceVisible: true,
          isOnSale: true,
          performanceStatusMessage: "",
        }],
      }],
    }, options);

    expect(result.snapshot.result).toBe("partial");
    expect(result.showings).toEqual([]);
    expect(result.warnings).toContain(
      "productions[0] has no trustworthy official detail URL.",
    );
  });
});
