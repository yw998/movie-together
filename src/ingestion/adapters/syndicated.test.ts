import { describe, expect, it } from "vitest";
import { parseSyndicatedHtml, SYNDICATED_SITE_TOKEN } from "./syndicated";

const options = {
  fetchedAt: "2026-08-14T14:00:00.000Z",
  contentHash: "syndicated-fixture",
  windowStart: "2026-08-14",
  windowEnd: "2026-08-20",
};

type FixtureEvent = {
  id: string;
  title: string;
  startsAt: string;
  duration: string;
  filmId: string;
  description?: string;
  soldOut?: boolean;
};

function fixture(events: FixtureEvent[], theaterName = "Syndicated Bar Theater Kitchen") {
  const byDate = events.map((event) => {
    const instant = new Date(event.startsAt);
    const weekday = instant.toLocaleDateString("en-US", {
      timeZone: "America/New_York", weekday: "long",
    });
    const day = instant.toLocaleDateString("en-US", {
      timeZone: "America/New_York", day: "numeric",
    });
    const month = instant.toLocaleDateString("en-US", {
      timeZone: "America/New_York", month: "long",
    });
    const date = `${weekday} ${day}, ${month}`;
    const time = new Date(event.startsAt).toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
    });
    return `<div class="date"><h3 class="date-title">${date}</h3><div class="film">
      <h3 class="title">${event.title}</h3><ul class="session-times"><li>
      <a${event.soldOut ? ' class="sold-out-session"' : ""}><time>${time}</time></a>
      ${event.soldOut ? '<span class="screen-attribute tickets-sold-out">SOLD OUT</span>' : ""}
      </li></ul></div></div>`;
  }).join("");
  const cards = [...new Map(events.map((event) => [event.title, event])).values()]
    .map((event) => `<div class="film" id="${event.filmId}" name="${event.filmId}">
      <h3 class="title">${event.title}</h3><p class="film-desc">${event.description ?? "Official synopsis long enough for classification."}</p>
      </div>`).join("");
  const jsonEvents = events.map((event) => ({
    "@type": "VisualArtsEvent",
    startDate: event.startsAt,
    duration: event.duration,
    location: { "@type": "Place", address: "40 Bogart St, Brooklyn, NY, 11206, USA", name: theaterName },
    name: event.title,
    url: `https://ticketing.useast.veezi.com/purchase/${event.id}?siteToken=${SYNDICATED_SITE_TOKEN}`,
    "@context": "http://schema.org",
  }));
  return `<div id="sessionsByDateConent">${byDate}</div><div id="sessionsByFilmConent">${cards}</div>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "MovieTheater", legalName: theaterName,
      location: { "@type": "Place", address: "40 Bogart St, Brooklyn, NY, 11206, USA" },
      name: theaterName, "@context": "http://schema.org",
    })}</script>
    <script type="application/ld+json">${JSON.stringify(jsonEvents)}</script>`;
}

describe("Syndicated official Veezi adapter", () => {
  it("extracts stable session/film IDs and retains sold-out evidence internally", () => {
    const html = fixture([{
      id: "6505", title: "Thief", startsAt: "2026-08-17T20:40:00-04:00",
      duration: "PT2H3M", filmId: "ST00002604", soldOut: true,
    }]);
    const result = parseSyndicatedHtml(html, options);
    expect(result.snapshot).toMatchObject({
      result: "success", parserVersion: "syndicated-veezi-html-jsonld-v1",
    });
    expect(result.films).toEqual([expect.objectContaining({
      id: "syndicated-ST00002604", displayTitle: "Thief", runtimeMinutes: 123,
    })]);
    expect(result.showings).toEqual([expect.objectContaining({
      id: "syndicated-6505", filmId: "syndicated-ST00002604",
      localDate: "2026-08-17", localTime: "20:40", availability: "sold_out",
      ticketUrl: expect.stringContaining("/purchase/6505"),
    })]);
  });

  it("matches dated open-caption notes to only the evidenced session", () => {
    const description = "A new film. Open caption screenings: Sunday 8/16 at 3:30pm.";
    const html = fixture([
      { id: "6500", title: "I Want Your Sex", startsAt: "2026-08-15T19:00:00-04:00", duration: "PT1H30M", filmId: "ST00002592", description },
      { id: "6501", title: "I Want Your Sex", startsAt: "2026-08-16T15:30:00-04:00", duration: "PT1H30M", filmId: "ST00002592", description },
    ]);
    const result = parseSyndicatedHtml(html, options);
    expect(result.showings[0]).toMatchObject({ eventType: "standard", eventNote: null });
    expect(result.showings[1]).toMatchObject({
      eventType: "open_caption",
      eventNote: "Open caption screenings: Sunday 8/16 at 3:30pm.",
    });
  });

  it("safely ignores an explicitly dated open-caption note outside the ingestion window", () => {
    const html = fixture([{
      id: "6502", title: "I Want Your Sex", startsAt: "2026-08-17T18:30:00-04:00",
      duration: "PT1H30M", filmId: "ST00002592",
      description: "A new film. Open caption screenings: Sunday 8/16 at 3:30pm.",
    }]);
    const result = parseSyndicatedHtml(html, {
      ...options, windowStart: "2026-08-17", windowEnd: "2026-08-23",
    });
    expect(result.snapshot.result).toBe("success");
    expect(result.warnings).toEqual([]);
    expect(result.showings[0]).toMatchObject({ eventType: "standard", eventNote: null });
  });

  it("still holds an in-window open-caption note that has no matching session", () => {
    const html = fixture([{
      id: "6502", title: "I Want Your Sex", startsAt: "2026-08-17T18:30:00-04:00",
      duration: "PT1H30M", filmId: "ST00002592",
      description: "A new film. Open caption screenings: Tuesday 8/18 at 3:30pm.",
    }]);
    const result = parseSyndicatedHtml(html, {
      ...options, windowStart: "2026-08-17", windowEnd: "2026-08-23",
    });
    expect(result.snapshot.result).toBe("partial");
    expect(result.warnings).toContain("syndicated-ST00002592 open-caption note matched 0 official sessions.");
  });

  it("marks official interactive and watch-party programs as special events", () => {
    const html = fixture([{
      id: "6474", title: "Taste of Streep presents: Mamma Mia!",
      startsAt: "2026-08-18T18:25:00-04:00", duration: "PT1H48M", filmId: "ST00002000",
      description: "Join us for an interactive movie party with games and prizes.",
    }]);
    const result = parseSyndicatedHtml(html, options);
    expect(result.showings[0]).toMatchObject({
      eventType: "other",
      eventNote: "Join us for an interactive movie party with games and prizes.",
    });
  });

  it("fails visibly when the official identity disappears", () => {
    const html = fixture([{
      id: "6505", title: "Thief", startsAt: "2026-08-17T20:40:00-04:00",
      duration: "PT2H3M", filmId: "ST00002604",
    }], "Another Theater");
    const result = parseSyndicatedHtml(html, options);
    expect(result.snapshot).toMatchObject({
      result: "failed",
      error: "Official theater identity or JSON-LD events were not found.",
    });
  });

  it("routes JSON-LD/HTML count mismatches to review", () => {
    const html = fixture([{
      id: "6505", title: "Thief", startsAt: "2026-08-17T20:40:00-04:00",
      duration: "PT2H3M", filmId: "ST00002604",
    }]).replace(/<div class="date">[\s\S]*?<\/div><\/div>/, "");
    const result = parseSyndicatedHtml(html, options);
    expect(result.snapshot.result).toBe("partial");
    expect(result.warnings.join(" ")).toMatch(/count mismatch/);
  });
});
