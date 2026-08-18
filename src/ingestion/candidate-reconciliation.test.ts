import { describe, expect, it } from "vitest";
import type { Showing } from "../types/schedule";
import { reconcileWeeklyCandidate } from "./candidate-reconciliation";
import type { ReviewBundle } from "./review-report";
import type { AdapterResult } from "./types";
import type { WeeklyIngestionBundle } from "./weekly-ingestion";

const priorShowing: Showing = {
  id: "syndicated-old", cinemaId: "syndicated", filmId: "old-film",
  startsAt: "2026-08-18T19:00:00-04:00", localDate: "2026-08-18", localTime: "19:00",
  format: null, eventType: "standard", eventNote: null,
  detailUrl: "https://example.com/old", ticketUrl: null, availability: "unknown",
  sourceUrl: "https://example.com/old", fetchedAt: "2026-08-16T09:00:00Z", extractionStatus: "verified",
};

function adapter(cinemaId: string, result: AdapterResult["snapshot"]["result"]): AdapterResult {
  return {
    cinemaId, films: [], showings: [], warnings: result === "success" ? [] : ["parser changed"],
    snapshot: {
      cinemaId, fetchedAt: "2026-08-17T09:00:00Z", sourceUrl: "https://example.com",
      contentHash: "hash", parserVersion: "fixture", result,
      error: result === "success" ? null : "review required",
    },
  };
}

function current(): WeeklyIngestionBundle {
  return {
    generatedAt: "2026-08-17T09:00:00Z", timezone: "America/New_York",
    windowKind: "calendar_week_monday_sunday", windowStart: "2026-08-17", windowEnd: "2026-08-23",
    adapters: [adapter("film-forum", "success"), adapter("syndicated", "partial")],
  };
}

describe("weekly candidate reconciliation", () => {
  it("keeps clean feeds and atomically carries forward an unclean cinema", () => {
    const previous: ReviewBundle = {
      generatedAt: "2026-08-16T09:00:00Z",
      adapters: [{ ...adapter("syndicated", "success"), showings: [priorShowing] }],
    };
    const result = reconcileWeeklyCandidate(current(), previous);
    expect(result.adapters[0].publicationFallback).toBeUndefined();
    expect(result.adapters[1]).toMatchObject({
      snapshot: { result: "partial" },
      warnings: ["parser changed"],
      showings: [{ id: "syndicated-old" }],
      publicationFallback: { mode: "previous_approved", sourceGeneratedAt: "2026-08-16T09:00:00Z" },
    });
  });

  it("stops when an unclean cinema has no approved fallback", () => {
    expect(() => reconcileWeeklyCandidate(current(), { generatedAt: new Date(0).toISOString(), adapters: [] }))
      .toThrow("no previous approved data exists");
  });

  it("rejects fallback facts from a different calendar week", () => {
    const previous: ReviewBundle = {
      generatedAt: "2026-08-16T09:00:00Z",
      adapters: [{
        ...adapter("syndicated", "success"),
        showings: [{ ...priorShowing, localDate: "2026-08-16" }],
      }],
    };
    expect(() => reconcileWeeklyCandidate(current(), previous)).toThrow("outside 2026-08-17 through 2026-08-23");
  });
});
