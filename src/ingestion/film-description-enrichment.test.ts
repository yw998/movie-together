import { describe, expect, it } from "vitest";
import publishedSchedule from "../data/published-schedule.json";
import type { Film, Showing } from "../types/schedule";
import { enrichFilmDescriptions } from "./film-description-enrichment";

const showing = {
  filmId: "vertigo",
  detailUrl: "https://metrograph.com/film/vertigo",
} as Showing;

function film(overrides: Partial<Film> = {}): Film {
  return {
    id: "vertigo",
    canonicalTitle: "Vertigo",
    displayTitle: "VERTIGO",
    year: null,
    director: null,
    runtimeMinutes: null,
    descriptionZh: null,
    descriptionSource: null,
    ...overrides,
  };
}

describe("film description enrichment", () => {
  it("reuses cached Chinese copy case-insensitively and records official provenance", () => {
    const [result] = enrichFilmDescriptions([film()], [showing]);
    expect(result.descriptionZh).toContain("希区柯克");
    expect(result.descriptionSource).toBe(showing.detailUrl);
  });

  it("uses supplemental copy for a new title and preserves adapter copy", () => {
    const current = film({
      id: "collateral",
      canonicalTitle: "Collateral",
      displayTitle: "Collateral",
    });
    const collateralShowing = {
      ...showing,
      filmId: "collateral",
      detailUrl: "https://metrograph.com/film/collateral",
    } as Showing;
    const [supplemented] = enrichFilmDescriptions([current], [collateralShowing]);
    expect(supplemented.descriptionZh).toContain("职业杀手");
    expect(supplemented.descriptionSource).toBe(collateralShowing.detailUrl);

    const [adapterCopy] = enrichFilmDescriptions([
      film({ descriptionZh: "影院提供的中文简介", descriptionSource: "https://cinema.example/film" }),
    ], [showing]);
    expect(adapterCopy).toMatchObject({
      descriptionZh: "影院提供的中文简介",
      descriptionSource: "https://cinema.example/film",
    });
  });

  it("covers every film in the current publication", () => {
    const enriched = enrichFilmDescriptions(
      publishedSchedule.films as Film[],
      publishedSchedule.showings as Showing[],
    );
    expect(enriched).toHaveLength(publishedSchedule.films.length);
    expect(
      enriched.filter((item) => !item.descriptionZh || !item.descriptionSource),
    ).toEqual([]);
  });
});
