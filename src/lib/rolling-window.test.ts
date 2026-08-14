import { describe, expect, it } from "vitest";
import { dateLabelsForWindow, rollingWindowFor } from "./rolling-window";

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

  it("builds display labels for every day in the rolling window", () => {
    expect(dateLabelsForWindow("2026-08-14", "2026-08-20")).toEqual({
      "2026-08-14": "周五 8/14",
      "2026-08-15": "周六 8/15",
      "2026-08-16": "周日 8/16",
      "2026-08-17": "周一 8/17",
      "2026-08-18": "周二 8/18",
      "2026-08-19": "周三 8/19",
      "2026-08-20": "周四 8/20",
    });
  });
});
