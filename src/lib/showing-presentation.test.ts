import { describe, expect, it } from "vitest";
import {
  independentTicketUrl,
  detailShowingUrl,
  showSpecialEventLabel,
  visibleShowingEventNote,
} from "./showing-presentation";

describe("showing presentation", () => {
  it("keeps the official details link separate from ticketing", () => {
    expect(detailShowingUrl({
      detailUrl: "https://my.filmforum.org/one-film",
      ticketUrl: "https://my.filmforum.org/one-film/11",
    })).toBe("https://my.filmforum.org/one-film");
    expect(independentTicketUrl({
      detailUrl: "https://my.filmforum.org/one-film",
      ticketUrl: "https://my.filmforum.org/one-film/11",
    })).toBe("https://my.filmforum.org/one-film/11");
    expect(detailShowingUrl({
      detailUrl: "https://cinema.example/film",
      ticketUrl: null,
    })).toBe("https://cinema.example/film");
    expect(independentTicketUrl({
      detailUrl: "https://cinema.example/film",
      ticketUrl: null,
    })).toBeNull();
    expect(independentTicketUrl({
      detailUrl: "https://cinema.example/film",
      ticketUrl: "https://cinema.example/film",
    })).toBeNull();
  });

  it("does not present availability text or a bare other value as a special event", () => {
    expect(visibleShowingEventNote({ eventType: "other", eventNote: "Sold Out!" })).toBeNull();
    expect(showSpecialEventLabel({ eventType: "other", eventNote: null })).toBe(false);
    expect(showSpecialEventLabel({ eventType: "other", eventNote: "Special Event" })).toBe(true);
  });
});
