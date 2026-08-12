import { describe, expect, it } from "vitest";
import { discoverParisClientConfig, parseParisPayloads } from "./paris-theater";

const options = {
  fetchedAt: "2026-08-11T23:00:00.000Z",
  contentHash: "paris-fixture",
  windowStart: "2026-08-11",
  windowEnd: "2026-08-17",
};

const cms = [{
  attributes: {
    FilmName: "A Clockwork Orange",
    VistaIDOverride: "HO00001234",
    FilmFormat: "DCP",
    Slug: "a-clockwork-orange-paris",
    Year: 1971,
    Director: "Stanley Kubrick",
    Runtime: 136,
    events: { data: [{ attributes: {
      EventName: "A CLOCKWORK ORANGE | Introduced by Rafer Guzmán",
      EventDate: "2026-08-16",
      TicketLink: "https://tickets.paristheaternyc.com/order/showtimes/2001-2948/seats",
    } }] },
  },
}];

describe("Paris Theater official API and CMS adapter", () => {
  it("discovers the public client contract without repository credentials", () => {
    const source = 'fetch("https://auth.moviexchange.com/connect/token",{body:new URLSearchParams({grant_type:"password",username:"fixture-user",password:"fixture-pass",client_id:"fixture-client",scope:"openid profile"})})';
    expect(discoverParisClientConfig(source)).toEqual({
      tokenUrl: "https://auth.moviexchange.com/connect/token",
      username: "fixture-user",
      password: "fixture-pass",
      clientId: "fixture-client",
      scope: "openid profile",
    });
    expect(discoverParisClientConfig(source.replaceAll('"', '\\"'))).not.toBeNull();
    const appended = 'x.append("client_id","".concat("fixture-client")),x.append("username","".concat("fixture-user")),x.append("password","".concat("fixture-pass"));"https://auth.moviexchange.com/connect/token"';
    expect(discoverParisClientConfig(appended)).toMatchObject({ clientId: "fixture-client" });
  });

  it("joins stable showtime IDs to CMS titles and preserves event labels", () => {
    const payload = {
      showtimes: [{
        id: "2001-2948",
        filmId: "HO00001234",
        schedule: { startsAt: "2026-08-16T12:00:00-04:00", businessDate: "2026-08-16" },
        isSoldOut: false,
        attributeIds: ["oc"],
      }],
      relatedData: { attributes: [{ id: "oc", shortName: { text: "Open Captions" } }] },
    };
    const result = parseParisPayloads([payload], cms, options);
    expect(result.snapshot.result).toBe("success");
    expect(result.films[0]).toMatchObject({ displayTitle: "A Clockwork Orange", year: 1971 });
    expect(result.showings[0]).toMatchObject({
      id: "paris-theater-2001-2948",
      startsAt: "2026-08-16T12:00:00-04:00",
      format: "DCP",
      eventType: "intro",
      eventNote: "A CLOCKWORK ORANGE | Introduced by Rafer Guzmán | Open Captions",
      availability: "available",
    });
  });

  it("fails visibly instead of publishing an unknown CMS film", () => {
    const payload = { showtimes: [{
      id: "unknown", filmId: "missing",
      schedule: { startsAt: "2026-08-16T12:00:00-04:00", businessDate: "2026-08-16" },
    }] };
    const result = parseParisPayloads([payload], [], options);
    expect(result.snapshot.result).toBe("partial");
    expect(result.showings).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("was not found in the official CMS");
  });
});
