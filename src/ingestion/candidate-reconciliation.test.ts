import { describe, expect, it } from "vitest";
import type { Showing } from "../types/schedule";
import { reconcileRollingCandidate } from "./candidate-reconciliation";
import type { ReviewBundle } from "./review-report";
import type { AdapterResult } from "./types";
import type { ScheduleIngestionBundle } from "./weekly-ingestion";

const priorShowing: Showing = {
  id: "syndicated-old", cinemaId: "syndicated", filmId: "old-film",
  startsAt: "2026-08-18T19:00:00-04:00", localDate: "2026-08-18", localTime: "19:00",
  format: null, eventType: "standard", eventNote: null,
  detailUrl: "https://example.com/old", ticketUrl: null, availability: "unknown",
  sourceUrl: "https://example.com/old", fetchedAt: "2026-08-16T09:00:00Z", extractionStatus: "verified",
};
const cleanShowing: Showing = {
  ...priorShowing,
  id: "film-forum-new",
  cinemaId: "film-forum",
  localDate: "2026-08-24",
  startsAt: "2026-08-24T19:00:00-04:00",
};

function adapter(cinemaId: string, result: AdapterResult["snapshot"]["result"]): AdapterResult {
  return {
    cinemaId,
    films: [],
    showings: result === "success" ? [{ ...cleanShowing, cinemaId }] : [],
    warnings: result === "success" ? [] : ["parser changed"],
    snapshot: {
      cinemaId, fetchedAt: "2026-08-18T09:00:00Z", sourceUrl: "https://example.com",
      contentHash: "hash", parserVersion: "fixture", result,
      error: result === "success" ? null : "review required",
    },
  };
}

function current(): ScheduleIngestionBundle {
  return {
    generatedAt: "2026-08-18T09:00:00Z", timezone: "America/New_York",
    windowKind: "rolling_seven_days", windowStart: "2026-08-18", windowEnd: "2026-08-24",
    adapters: [adapter("film-forum", "success"), adapter("syndicated", "partial")],
  };
}

function previous(showing = priorShowing): ReviewBundle {
  return {
    generatedAt: "2026-08-17T09:00:00Z",
    windowStart: "2026-08-17",
    windowEnd: "2026-08-23",
    adapters: [{ ...adapter("syndicated", "success"), showings: [showing] }],
  };
}

describe("rolling candidate reconciliation", () => {
  it("keeps clean feeds, carries overlapping approved dates, and omits the uncovered date", () => {
    const result = reconcileRollingCandidate(current(), previous());
    expect(result.adapters[0].publicationFallback).toBeUndefined();
    expect(result.adapters[1]).toMatchObject({
      snapshot: { result: "partial" },
      warnings: ["parser changed"],
      showings: [{ id: "syndicated-old" }],
      publicationFallback: {
        mode: "date_scoped",
        sourceGeneratedAt: "2026-08-17T09:00:00Z",
        fallbackDates: ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"],
        unavailableDates: ["2026-08-24"],
      },
    });
  });

  it("omits an unclean cinema with no baseline while keeping clean cinemas", () => {
    const result = reconcileRollingCandidate(current(), {
      generatedAt: new Date(0).toISOString(), adapters: [],
    });
    expect(result.adapters[1].showings).toEqual([]);
    expect(result.adapters[1].publicationFallback).toMatchObject({
      mode: "date_scoped",
      sourceGeneratedAt: null,
      fallbackDates: [],
      unavailableDates: [
        "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
        "2026-08-22", "2026-08-23", "2026-08-24",
      ],
    });
  });

  it("rejects facts outside the declared previous approved window", () => {
    expect(() => reconcileRollingCandidate(current(), previous({
      ...priorShowing, localDate: "2026-08-16",
    }))).toThrow("outside 2026-08-17 through 2026-08-23");
  });

  it("stops when no verified or approved showings remain", () => {
    const allFailed = { ...current(), adapters: [adapter("film-forum", "failed"), adapter("syndicated", "partial")] };
    expect(() => reconcileRollingCandidate(allFailed, { generatedAt: new Date(0).toISOString(), adapters: [] }))
      .toThrow("No verified or previously approved showings remain");
  });
});
