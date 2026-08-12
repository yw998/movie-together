import { describe, expect, it } from "vitest";
import { metrographRequestUrl, parseMetrographHtml } from "./metrograph";

const options = {
  fetchedAt: "2026-08-11T22:30:00.000Z",
  contentHash: "metrograph-fixture",
  windowStart: "2026-08-11",
  windowEnd: "2026-08-17",
};

const fixture = `<div class="homepage-in-theater-movie"><div class="row">
  <div class="col-sm-6"><h3 class="movie_title"><a href="/film/?vista_film_id=90">Vertigo</a></h3>
    <div class="showtimes">
      <div id="day_Tue_Aug_11" class="film_day">
        <a href="https://t.metrograph.com/Ticketing/visSelectTickets.aspx?cinemacode=9999&amp;txtSessionId=31001" title="Buy Tickets">3:15pm</a>
        <a class="sold_out" title="Sold Out">7:00pm</a>
      </div>
    </div>
    <h5>1958 / 128min / 35mm</h5>
  </div>
</div></div>`;

describe("Metrograph official film-page adapter", () => {
  it("extracts Vista sessions, format, and sold-out showings", () => {
    const result = parseMetrographHtml(fixture, options);
    expect(result.snapshot).toMatchObject({
      result: "success",
      parserVersion: "metrograph-film-html-v2",
    });
    expect(result.showings).toEqual([
      expect.objectContaining({
        id: "metrograph-31001",
        startsAt: "2026-08-11T15:15:00-04:00",
        format: "35mm",
        availability: "available",
      }),
      expect.objectContaining({
        id: "metrograph-sold-out-vertigo-2026-08-11-1900",
        ticketUrl: null,
        availability: "sold_out",
      }),
    ]);
    expect(result.films.map((film) => film.displayTitle)).toEqual(["Vertigo"]);
  });

  it("preserves members-only and open-caption labels", () => {
    const members = fixture.replaceAll("Vertigo", "Members Only: Film");
    const captions = fixture
      .replaceAll("Vertigo", "Film — Open Captions")
      .replace("txtSessionId=31001", "txtSessionId=31002")
      .replace("7:00pm", "8:00pm");
    const result = parseMetrographHtml(`${members}${captions}`, options);
    expect(result.showings.map((showing) => showing.eventType)).toEqual([
      "members_only",
      "members_only",
      "open_caption",
      "open_caption",
    ]);
  });

  it("fails visibly when the film-card structure disappears", () => {
    const result = parseMetrographHtml("<html></html>", options);
    expect(result.snapshot).toMatchObject({
      result: "failed",
      error: "In-theater film cards were not found.",
    });
  });

  it("uses an hourly refresh key to avoid Metrograph's incomplete bare-URL cache", () => {
    expect(metrographRequestUrl("2026-08-12T15:42:10.000Z")).toBe(
      "https://metrograph.com/film/?schedule_refresh=2026-08-12T15",
    );
    expect(metrographRequestUrl("2026-08-12T15:59:59.000Z")).toBe(
      "https://metrograph.com/film/?schedule_refresh=2026-08-12T15",
    );
  });
});
