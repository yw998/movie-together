import { describe, expect, it, vi } from "vitest";
import { fetchWeeklyIngestionBundle, type ScheduleFetcher } from "./weekly-ingestion";
import type { AdapterResult } from "./types";

function result(cinemaId: string): AdapterResult {
  return {
    cinemaId, films: [], showings: [], warnings: [],
    snapshot: {
      cinemaId, fetchedAt: "2026-08-11T20:00:00Z", sourceUrl: "https://example.com",
      contentHash: "hash", parserVersion: "fixture", result: "success", error: null,
    },
  };
}

describe("weekly ingestion candidate", () => {
  it("runs every adapter for the containing Monday–Sunday window", async () => {
    const first = vi.fn<ScheduleFetcher>().mockResolvedValue(result("first"));
    const second = vi.fn<ScheduleFetcher>().mockResolvedValue(result("second"));
    const bundle = await fetchWeeklyIngestionBundle("2026-08-11", [first, second]);
    expect(first).toHaveBeenCalledWith("2026-08-10", "2026-08-16");
    expect(second).toHaveBeenCalledWith("2026-08-10", "2026-08-16");
    expect(bundle).toMatchObject({
      timezone: "America/New_York",
      windowKind: "calendar_week_monday_sunday",
      windowStart: "2026-08-10",
      windowEnd: "2026-08-16",
    });
    expect(bundle.adapters.map((adapter) => adapter.cinemaId)).toEqual(["first", "second"]);
  });
});
