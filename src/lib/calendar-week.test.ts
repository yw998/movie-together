import { describe, expect, it } from "vitest";
import { calendarWeekFor } from "./calendar-week";

describe("Monday–Sunday calendar windows", () => {
  it("returns the containing calendar week", () => {
    expect(calendarWeekFor("2026-08-11")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(calendarWeekFor("2026-08-10")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(calendarWeekFor("2026-08-16")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });
  it("handles month and year boundaries without timezone drift", () => {
    expect(calendarWeekFor("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });
});
