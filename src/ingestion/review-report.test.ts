import { describe, expect, it } from "vitest";
import type { Showing } from "../types/schedule";
import { createReviewReport, formatReviewReport, type ReviewBundle } from "./review-report";
import type { AdapterResult } from "./types";

function showing(id: string, overrides: Partial<Showing> = {}): Showing {
  return {
    id, cinemaId: "film-forum", filmId: "film",
    startsAt: "2026-08-11T19:00:00-04:00", localDate: "2026-08-11", localTime: "19:00",
    format: null, eventType: "standard", eventNote: null,
    detailUrl: "https://filmforum.org/film/film", ticketUrl: "https://my.filmforum.org/1",
    availability: "available", sourceUrl: "https://my.filmforum.org/api",
    fetchedAt: "2026-08-11T20:00:00Z", extractionStatus: "verified", ...overrides,
  };
}

function adapter(showings: Showing[], result: AdapterResult["snapshot"]["result"] = "success"): AdapterResult {
  return {
    cinemaId: "film-forum", films: [], showings,
    warnings: result === "partial" ? ["one uncertain record"] : [],
    snapshot: {
      cinemaId: "film-forum", fetchedAt: "2026-08-11T20:00:00Z",
      sourceUrl: "https://my.filmforum.org/api", contentHash: "hash", parserVersion: "fixture",
      result, error: result === "success" ? null : "review",
    },
  };
}
function bundle(value: AdapterResult): ReviewBundle {
  return { generatedAt: "2026-08-11T20:00:00Z", adapters: [value] };
}

describe("ingestion review report", () => {
  it("reports added, removed, and changed schedule facts", () => {
    const previous = bundle(adapter([showing("kept"), showing("removed")]));
    const current = bundle(adapter([
      showing("kept", { localTime: "20:00", startsAt: "2026-08-11T20:00:00-04:00" }),
      showing("added"),
    ]));
    const report = createReviewReport(previous, current, "a".repeat(64));
    expect(report.summary).toMatchObject({ added: 1, removed: 1, changed: 1, concerns: 0 });
    expect(report.cinemas[0].changes[0].changedFields).toEqual(["startsAt", "localTime"]);
    expect(formatReviewReport(report)).toContain("Changed: kept (startsAt, localTime)");
  });

  it("holds publication for partial feeds, warnings, duplicates, and large drops", () => {
    const previous = bundle(adapter([showing("1"), showing("2"), showing("3"), showing("4")]));
    const current = bundle(adapter([showing("1"), showing("1")], "partial"));
    const report = createReviewReport(previous, current, "b".repeat(64));
    expect(report.publishable).toBe(false);
    expect(report.cinemas[0].concerns.join(" ")).toMatch(/partial.*Parser warning.*Duplicate.*25%/);
  });

  it("does not treat already-finished showings disappearing as an upcoming feed drop", () => {
    const finished = ["1", "2", "3", "4"].map((id) =>
      showing(id, { startsAt: `2026-08-10T1${id}:00:00-04:00`, localDate: "2026-08-10" }),
    );
    const future = [showing("5"), showing("6")];
    const report = createReviewReport(
      bundle(adapter([...finished, ...future])),
      bundle(adapter(future)),
      "e".repeat(64),
    );

    expect(report.summary.removed).toBe(4);
    expect(report.cinemas[0].concerns).toEqual([]);
    expect(report.publishable).toBe(true);
  });

  it("accepts validated manual records but blocks needs-review records", () => {
    const previous = bundle(adapter([]));
    const manual = createReviewReport(
      previous,
      bundle(adapter([showing("manual", { extractionStatus: "manual" })])),
      "c".repeat(64),
    );
    const uncertain = createReviewReport(
      previous,
      bundle(adapter([showing("uncertain", { extractionStatus: "needs_review" })])),
      "d".repeat(64),
    );
    expect(manual.publishable).toBe(true);
    expect(uncertain.publishable).toBe(false);
  });
});
