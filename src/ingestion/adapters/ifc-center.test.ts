import { describe, expect, it } from "vitest";
import { parseIfcCenterHtml } from "./ifc-center";

const options = {
  fetchedAt: "2026-08-11T21:30:00.000Z",
  contentHash: "fixture-hash",
  windowStart: "2026-08-11",
  windowEnd: "2026-08-17",
};

const fixture = `
  <div id="js-showtimes-widget">
    <div class="daily-schedule tue active">
      <h3>Tue Aug 11</h3>
      <ul><li>
        <div class="details">
          <h3><a href="https://www.ifccenter.com/films/union-county/">Union County</a></h3>
          <ul class="times">
            <li><a href="https://tickets.ifccenter.com/websales/pages/ticketsearchcriteria.aspx?evtinfo=572000~venue&amp;">2:30 PM</a></li>
            <li><a href="https://tickets.ifccenter.com/websales/pages/ticketsearchcriteria.aspx?evtinfo=572001~venue&amp;">7:00 PM</a></li>
          </ul>
        </div>
      </li></ul>
    </div>
  </div>
  <li class="ipe-single-container">
    <p><span>Tue Aug 11:</span><span class="ipe-title"><a href="https://www.ifccenter.com/films/union-county/">Union County</a></span>
    <span class="ipe-caption">Q&amp;A with director after the 7:00 show</span></p>
  </li>`;

describe("IFC Center official HTML adapter", () => {
  it("extracts dated showings, direct tickets, and a uniquely matched Q&A", () => {
    const result = parseIfcCenterHtml(fixture, options);
    expect(result.snapshot).toMatchObject({
      result: "success",
      parserVersion: "ifc-center-html-v3",
      contentHash: "fixture-hash",
    });
    expect(result.showings).toHaveLength(2);
    expect(result.showings[0]).toMatchObject({
      id: "ifc-center-572000",
      startsAt: "2026-08-11T14:30:00-04:00",
      localDate: "2026-08-11",
      localTime: "14:30",
      ticketUrl: expect.stringContaining("evtinfo=572000"),
    });
    expect(result.showings[1]).toMatchObject({
      eventType: "qa",
      eventNote: "Q&A with director after the 7:00 show",
    });
  });

  it("routes an unresolvable event caption to review", () => {
    const html = fixture.replace("after the 7:00 show", "in person");
    const result = parseIfcCenterHtml(html, options);
    expect(result.snapshot.result).toBe("partial");
    expect(result.warnings).toEqual([
      expect.stringContaining("could not be tied to one showtime"),
    ]);
    expect(result.showings.every((showing) => showing.eventNote === null)).toBe(true);
  });

  it("uses a unique detail-page ticket link when an event caption omits the time", () => {
    const eventWithoutTime = fixture.replace(
      "Q&amp;A with director after the 7:00 show</span>",
      "Q&amp;A with director</span>",
    );
    const detailPage = `
      <li>
        <div class="details">
          <span><strong>Tue Aug 11:</strong></span>
          <p><strong>Q&amp;A with director</strong></p>
        </div>
        <a href="https://tickets.ifccenter.com/websales/pages/ticketsearchcriteria.aspx?evtinfo=572001~venue&amp;">Sold Out</a>
      </li>`;
    const result = parseIfcCenterHtml(eventWithoutTime, {
      ...options,
      detailPages: new Map([
        ["https://www.ifccenter.com/films/union-county/", detailPage],
      ]),
    });
    expect(result.snapshot.result).toBe("success");
    expect(result.showings[1]).toMatchObject({
      id: "ifc-center-572001",
      eventType: "qa",
      eventNote: "Q&A with director",
      availability: "sold_out",
    });
  });

  it("deduplicates repeated desktop and mobile special-event widgets", () => {
    const repeatedEvent = fixture.slice(fixture.indexOf('<li class="ipe-single-container">'));
    const result = parseIfcCenterHtml(`${fixture}${repeatedEvent}`, options);
    expect(result.snapshot.result).toBe("success");
    expect(result.showings.filter((showing) => showing.eventNote)).toHaveLength(1);
  });

  it("ignores valid adjacent dates outside the requested window", () => {
    const adjacent = fixture.replaceAll("Tue Aug 11", "Tue Aug 18");
    const result = parseIfcCenterHtml(`${fixture}${adjacent}`, options);
    expect(result.snapshot.result).toBe("success");
    expect(result.showings).toHaveLength(2);
  });

  it("ignores recognizable special-event dates well outside the requested window", () => {
    const distantEvent = fixture.replaceAll("Tue Aug 11", "Tue Sep 15");
    const result = parseIfcCenterHtml(`${fixture}${distantEvent}`, options);
    expect(result.snapshot.result).toBe("success");
    expect(result.warnings).toEqual([]);
    expect(result.showings).toHaveLength(2);
  });

  it("fails visibly when the showtimes widget disappears", () => {
    const result = parseIfcCenterHtml("<html></html>", options);
    expect(result.snapshot).toMatchObject({
      result: "failed",
      error: "Showtimes widget was not found.",
    });
  });
});
