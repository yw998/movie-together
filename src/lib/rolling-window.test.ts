import { describe, expect, it } from "vitest";
import { datesForWindow, rollingWindowFor } from "./rolling-window";

describe("rolling seven-day publication window", () => {
  it("spans two storage weeks when today is midweek", () => {
    expect(rollingWindowFor("2026-08-12")).toEqual({
      start: "2026-08-12",
      end: "2026-08-18",
      weekStarts: ["2026-08-10", "2026-08-17"],
    });
  });

  it("uses one storage week when today is Monday", () => {
    expect(rollingWindowFor("2026-08-17")).toEqual({
      start: "2026-08-17",
      end: "2026-08-23",
      weekStarts: ["2026-08-17"],
    });
  });

  it("returns language-neutral dates for the rolling window", () => {
    expect(datesForWindow("2026-08-14", "2026-08-20")).toEqual([
      "2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17",
      "2026-08-18", "2026-08-19", "2026-08-20",
    ]);
  });
});
