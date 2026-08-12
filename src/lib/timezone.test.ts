import { describe, expect, it } from "vitest";
import { zonedLocalDateTimeToIso } from "./timezone";

describe("America/New_York civil timestamps", () => {
  it("uses daylight time in August and standard time in January", () => {
    expect(zonedLocalDateTimeToIso("2026-08-11", "19:30")).toBe(
      "2026-08-11T19:30:00-04:00",
    );
    expect(zonedLocalDateTimeToIso("2026-01-11", "19:30")).toBe(
      "2026-01-11T19:30:00-05:00",
    );
  });

  it("fails visibly for nonexistent and ambiguous DST times", () => {
    expect(() => zonedLocalDateTimeToIso("2026-03-08", "02:30")).toThrow(
      "Nonexistent local time",
    );
    expect(() => zonedLocalDateTimeToIso("2026-11-01", "01:30")).toThrow(
      "Ambiguous local time",
    );
  });

  it("rejects impossible calendar dates", () => {
    expect(() => zonedLocalDateTimeToIso("2026-02-30", "12:00")).toThrow(
      "Invalid local date/time",
    );
  });
});
