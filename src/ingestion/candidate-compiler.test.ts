import { describe, expect, it } from "vitest";
import type { Film, Showing } from "../types/schedule";
import { compileWeeklyCandidate } from "./candidate-compiler";
import type { ManualOverrideFile } from "./manual-overrides";
import type { AdapterResult } from "./types";
import type { WeeklyIngestionBundle } from "./weekly-ingestion";
import { compiledScheduleReviewBundle } from "./compiled-review";
import { digestReviewBundle } from "./review-digest";
import { prepareApprovedSchedule } from "./promotion";

const film: Film = {
  id: "fixture-film", canonicalTitle: "Fixture Film", displayTitle: "Fixture Film",
  year: null, director: null, runtimeMinutes: null, descriptionZh: null, descriptionSource: null,
};
const showing: Showing = {
  id: "film-forum-1", cinemaId: "film-forum", filmId: film.id,
  startsAt: "2026-08-10T19:00:00-04:00", localDate: "2026-08-10", localTime: "19:00",
  format: null, eventType: "standard", eventNote: null,
  detailUrl: "https://my.filmforum.org/1", ticketUrl: "https://my.filmforum.org/1",
  availability: "available", sourceUrl: "https://my.filmforum.org/api",
  fetchedAt: "2026-08-10T14:00:00Z", extractionStatus: "verified",
};
const cinemaIds = ["metrograph", "film-forum", "ifc-center", "roxy-cinema", "paris-theater", "film-at-lincoln-center", "syndicated"];

function adapter(cinemaId: string): AdapterResult {
  return {
    cinemaId,
    films: cinemaId === "film-forum" ? [film] : [],
    showings: cinemaId === "film-forum" ? [showing] : [],
    warnings: [],
    snapshot: {
      cinemaId, fetchedAt: "2026-08-10T14:00:00Z", sourceUrl: "https://example.com",
      contentHash: "hash", parserVersion: "fixture", result: "success", error: null,
    },
  };
}
function bundle(): WeeklyIngestionBundle {
  return {
    generatedAt: "2026-08-10T14:00:00Z", timezone: "America/New_York",
    windowKind: "calendar_week_monday_sunday", windowStart: "2026-08-10", windowEnd: "2026-08-16",
    adapters: cinemaIds.map(adapter),
  };
}

describe("weekly candidate compiler", () => {
  it("merges clean adapters into validated normalized public data", () => {
    const result = compileWeeklyCandidate(bundle());
    expect(result.schedule.metadata).toMatchObject({
      windowStart: "2026-08-10", windowEnd: "2026-08-16", refreshedLocalDate: "2026-08-10",
    });
    expect(Object.values(result.schedule.dateLabels)).toEqual([
      "周一 8/10", "周二 8/11", "周三 8/12", "周四 8/13", "周五 8/14", "周六 8/15", "周日 8/16",
    ]);
    expect(result.schedule.showings).toHaveLength(1);
  });

  it("applies only week-scoped, evidence-backed manual overrides", () => {
    const overrides: ManualOverrideFile = {
      windowStart: "2026-08-10", windowEnd: "2026-08-16",
      entries: [{
        operation: "remove", showingId: showing.id,
        sourceUrl: "https://my.filmforum.org/1", reason: "Official event page cancelled this screening.",
        enteredAt: "2026-08-10T15:00:00Z",
      }],
    };
    const result = compileWeeklyCandidate(bundle(), overrides);
    expect(result.schedule.showings).toHaveLength(0);
    expect(result).toMatchObject({ appliedOverrides: 1, removedByOverride: [showing.id] });
  });

  it("rejects partial feeds and overrides from a different week", () => {
    const partial = bundle();
    partial.adapters[0].snapshot.result = "partial";
    partial.adapters[0].warnings = ["unresolved fixture"];
    expect(() => compileWeeklyCandidate(partial, undefined, { requireCleanSources: true })).toThrow("unresolved review warnings");
    const wrongWeek: ManualOverrideFile = {
      windowStart: "2026-08-17", windowEnd: "2026-08-23", entries: [],
    };
    expect(() => compileWeeklyCandidate(bundle(), wrongWeek)).toThrow("exactly match");
  });

  it("promotes only the exact compiled facts covered by approval", async () => {
    const source = bundle();
    const compiled = compileWeeklyCandidate(source, undefined, { requireCleanSources: true });
    const digest = await digestReviewBundle(compiledScheduleReviewBundle(source, compiled.schedule));
    const approval = {
      reportGeneratedAt: source.generatedAt, candidateDigest: digest,
      approvedAt: "2026-08-10T16:00:00Z", approvedBy: "Editor",
      decision: "approved" as const,
      reviewedSummary: { cinemas: 5, added: 1, removed: 0, changed: 0, concerns: 0 },
    };
    await expect(prepareApprovedSchedule(source, approval)).resolves.toEqual(compiled.schedule);
    await expect(
      prepareApprovedSchedule(source, { ...approval, candidateDigest: "0".repeat(64) }),
    ).rejects.toThrow("digest does not match");
  });
});
