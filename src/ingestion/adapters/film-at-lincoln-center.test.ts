import { describe, expect, it } from "vitest";
import { parseFilmLincPayload, type FilmLincDetails } from "./film-at-lincoln-center";

const options = {
  fetchedAt: "2026-08-11T22:30:00.000Z",
  contentHash: "film-linc-fixture",
  windowStart: "2026-08-10",
  windowEnd: "2026-08-16",
};

const details: FilmLincDetails = {
  title: "Cam",
  excerpt: "A cam performer fights to regain control of her online identity.",
  director: "Daniel Goldhaber",
  year: 2018,
  runtimeMinutes: 95,
  formats: ["35mm"],
  accessibility: ["CC"],
  specialEvents: [{
    tessituraId: "83546",
    promoShort: ["qa"],
    promoTooltip: "Q&A with Daniel Goldhaber and Madeline Brewer",
  }],
};

const payload = {
  films: [{
    id: "83545",
    title: "Cam",
    slug: "cam",
    showtimes: [{
      id: "83546",
      productionSeasonId: "83545",
      date: "2026-08-13",
      time: "9:00 PM",
      dateTimeET: "2026-08-13T21:00:00-04:00",
      venue: "Walter Reade Theater",
      available: true,
      ticketsUrl: "https://purchase.filmlinc.org/83545/83546",
      openCaptions: true,
      freeEvent: false,
      status: "available",
    }],
  }],
};

describe("Film at Lincoln Center official API adapter", () => {
  it("joins stable ticket IDs to official formats and Q&A metadata", () => {
    const result = parseFilmLincPayload(payload, new Map([["cam", details]]), options);
    expect(result.snapshot).toMatchObject({
      result: "success",
      parserVersion: "film-linc-api-graphql-v2",
    });
    expect(result.films).toEqual([expect.objectContaining({
      id: "cam",
      director: "Daniel Goldhaber",
      year: 2018,
      runtimeMinutes: 95,
    })]);
    expect(result.showings).toEqual([expect.objectContaining({
      id: "film-at-lincoln-center-83546",
      startsAt: "2026-08-13T21:00:00-04:00",
      format: "35mm",
      eventType: "qa",
      eventNote: "Q&A with Daniel Goldhaber and Madeline Brewer · Open Captions",
      ticketUrl: "https://purchase.filmlinc.org/83545/83546",
      availability: "available",
    })]);
  });

  it("retains standby screenings with a sold-out label and exact standby note", () => {
    const standby = structuredClone(payload);
    standby.films[0].showtimes[0].available = false;
    standby.films[0].showtimes[0].status = "standby";
    standby.films[0].showtimes[0].openCaptions = false;
    const result = parseFilmLincPayload(standby, new Map([["cam", details]]), options);
    expect(result.showings[0]).toMatchObject({
      availability: "sold_out",
      eventNote: "Q&A with Daniel Goldhaber and Madeline Brewer · Standby Only",
    });
  });

  it("publishes an official free gallery event without film GraphQL details", () => {
    const galleryEvent = {
      films: [{
        id: "83772",
        title: "FLC Book Fair",
        slug: "flc-book-fair",
        showtimes: [{
          id: "83774",
          productionSeasonId: "83772",
          date: "2026-08-13",
          time: "2:30 PM",
          dateTimeET: "2026-08-13T14:30:00-04:00",
          venue: "Furman Gallery",
          available: true,
          ticketsUrl: "https://purchase.filmlinc.org/83772/83774",
          openCaptions: false,
          freeEvent: true,
          status: "available",
          description: "FLC Book Fair",
        }],
      }],
    };

    const result = parseFilmLincPayload(galleryEvent, new Map(), options);
    expect(result.snapshot.result).toBe("success");
    expect(result.films[0]).toMatchObject({
      id: "flc-book-fair",
      displayTitle: "FLC Book Fair",
      year: null,
      director: null,
      runtimeMinutes: null,
    });
    expect(result.showings[0]).toMatchObject({
      id: "film-at-lincoln-center-83774",
      eventType: "other",
      eventNote: "Furman Gallery · Free Event",
      detailUrl: "https://www.filmlinc.org/now-playing/",
      ticketUrl: "https://purchase.filmlinc.org/83772/83774",
      availability: "available",
    });
  });

  it("fails visibly when details or trustworthy IDs are missing", () => {
    const noDetails = parseFilmLincPayload(payload, new Map(), options);
    expect(noDetails.snapshot.result).toBe("partial");
    expect(noDetails.warnings[0]).toContain("no official GraphQL details");

    const invalid = structuredClone(payload);
    invalid.films[0].showtimes[0].dateTimeET = "2026-08-13T21:00:00Z";
    const badTime = parseFilmLincPayload(invalid, new Map([["cam", details]]), options);
    expect(badTime.snapshot.result).toBe("partial");
    expect(badTime.showings).toHaveLength(0);
  });
});
