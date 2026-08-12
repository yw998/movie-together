import { describe, expect, it } from "vitest";
import {
  defaultScheduleDate,
  formatDisplayTime,
  getTimeCluster,
  hasShowingStarted,
  minutesSinceMidnight,
  newYorkLocalDate,
  parseDisplayTime,
} from "./time";

describe("New York local time helpers", () => {
  it("normalizes noon and midnight without changing the local date", () => {
    expect(parseDisplayTime("12:00 AM")).toBe("00:00");
    expect(parseDisplayTime("12:00 PM")).toBe("12:00");
    expect(formatDisplayTime("00:00")).toBe("12:00 AM");
    expect(formatDisplayTime("12:00")).toBe("12:00 PM");
  });

  it("sorts chronologically across noon and midnight", () => {
    const times = ["21:00", "00:15", "12:00", "09:30"];
    expect(times.sort((a, b) => minutesSinceMidnight(a) - minutesSinceMidnight(b))).toEqual([
      "00:15",
      "09:30",
      "12:00",
      "21:00",
    ]);
  });

  it("uses the specified time-cluster boundaries", () => {
    expect(getTimeCluster("11:59")).toBe("上午");
    expect(getTimeCluster("12:00")).toBe("下午");
    expect(getTimeCluster("16:59")).toBe("下午");
    expect(getTimeCluster("17:00")).toBe("晚间");
    expect(getTimeCluster("20:59")).toBe("晚间");
    expect(getTimeCluster("21:00")).toBe("深夜");
  });

  it("rejects malformed values", () => {
    expect(() => parseDisplayTime("noon")).toThrow("Invalid display time");
    expect(() => minutesSinceMidnight("24:00")).toThrow("Invalid local time");
  });

  it("derives today from New York rather than the browser timezone", () => {
    expect(newYorkLocalDate(Date.parse("2026-08-12T03:59:00Z"))).toBe("2026-08-11");
    expect(newYorkLocalDate(Date.parse("2026-08-12T04:00:00Z"))).toBe("2026-08-12");
  });

  it("selects New York today and safely clamps outside the published window", () => {
    const dates = ["2026-08-12", "2026-08-13", "2026-08-14"];
    expect(defaultScheduleDate(dates, dates[0], Date.parse("2026-08-13T16:00:00Z"))).toBe("2026-08-13");
    expect(defaultScheduleDate(dates, dates[0], Date.parse("2026-08-10T16:00:00Z"))).toBe("2026-08-12");
    expect(defaultScheduleDate(dates, dates[0], Date.parse("2026-08-16T16:00:00Z"))).toBe("2026-08-14");
  });

  it("treats a showing as hidden from its exact start time", () => {
    const startsAt = "2026-08-12T19:00:00-04:00";
    expect(hasShowingStarted(startsAt, Date.parse("2026-08-12T22:59:59Z"))).toBe(false);
    expect(hasShowingStarted(startsAt, Date.parse("2026-08-12T23:00:00Z"))).toBe(true);
  });
});
