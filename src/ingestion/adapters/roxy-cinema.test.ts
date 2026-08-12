import { describe, expect, it } from "vitest";
import { parseRoxyCinemaHtml } from "./roxy-cinema";

const options = {
  fetchedAt: "2026-08-11T22:00:00.000Z",
  contentHash: "roxy-fixture",
  windowStart: "2026-08-11",
  windowEnd: "2026-08-17",
};

function card({
  datetime = "2026-08-11T19:00:00.000-0400",
  ticket = "7646",
  title = "Session 9 + Q&A",
  copy = "Post-screening Q&A with Director Brad Anderson and actor Stephen Gevedon!",
  detail = "session-9",
} = {}) {
  return `<div class="detailed-screening__card" data-datetime="${datetime}">
    <a class="detailed-screening__cta cta--primary-small" href="https://ticketing.uswest.veezi.com/purchase/${ticket}?siteToken=token">Buy</a>
    <h3 class="detailed-screening__title">${title}</h3>
    <p class="detailed-screening__copy">${copy}</p>
    <a class="detailed-screening__cta cta--text-link" href="https://www.roxycinemanewyork.com/screenings/${detail}/">Read More</a>
  </div>`;
}

describe("Roxy Cinema official HTML adapter", () => {
  it("extracts explicit timestamps, Veezi IDs, and Q&A guests", () => {
    const result = parseRoxyCinemaHtml(card(), options);
    expect(result.snapshot).toMatchObject({
      result: "success",
      parserVersion: "roxy-cinema-html-v1",
    });
    expect(result.showings).toEqual([
      expect.objectContaining({
        id: "roxy-cinema-7646",
        startsAt: "2026-08-11T19:00:00.000-04:00",
        eventType: "qa",
        eventNote:
          "Post-screening Q&A with Director Brad Anderson and actor Stephen Gevedon!",
        ticketUrl: expect.stringContaining("/purchase/7646"),
      }),
    ]);
  });

  it("preserves 35mm and only applies dated introductions to their date", () => {
    const matching = card({
      title: "Black Book - 35MM | 2006 Movies",
      copy: "Introduced by Caroline Golum 8/11.",
      ticket: "7669",
      detail: "black-book-35mm",
    });
    const later = card({
      datetime: "2026-08-12T18:45:00.000-0400",
      title: "Black Book - 35MM | 2006 Movies",
      copy: "Introduced by Caroline Golum 8/11.",
      ticket: "7670",
      detail: "black-book-35mm",
    });
    const result = parseRoxyCinemaHtml(`${matching}${later}`, options);
    expect(result.showings[0]).toMatchObject({
      format: "35mm",
      eventType: "intro",
      eventNote: "Introduced by Caroline Golum 8/11.",
    });
    expect(result.showings[1]).toMatchObject({
      format: "35mm",
      eventType: "standard",
      eventNote: null,
    });
  });

  it("fails visibly when the screening structure disappears", () => {
    const result = parseRoxyCinemaHtml("<html></html>", options);
    expect(result.snapshot).toMatchObject({
      result: "failed",
      error: "Screening cards were not found.",
    });
  });
});
