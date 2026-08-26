import { describe, expect, it } from "vitest";
import {
  officialShowingUrl,
  showSpecialEventLabel,
  visibleShowingEventNote,
} from "./showing-presentation";

describe("showing presentation", () => {
  it("opens a performance-specific ticket URL when one exists", () => {
    expect(officialShowingUrl({
      detailUrl: "https://my.filmforum.org/one-film",
      ticketUrl: "https://my.filmforum.org/one-film/11",
    })).toBe("https://my.filmforum.org/one-film/11");
    expect(officialShowingUrl({
      detailUrl: "https://cinema.example/film",
      ticketUrl: null,
    })).toBe("https://cinema.example/film");
  });

  it("does not present availability text or a bare other value as a special event", () => {
    expect(visibleShowingEventNote({ eventType: "other", eventNote: "Sold Out!" })).toBeNull();
    expect(showSpecialEventLabel({ eventType: "other", eventNote: null })).toBe(false);
    expect(showSpecialEventLabel({ eventType: "other", eventNote: "Special Event" })).toBe(true);
  });
});
