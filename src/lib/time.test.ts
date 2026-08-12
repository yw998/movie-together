import { describe, expect, it } from "vitest";
import {
  formatDisplayTime,
  getTimeCluster,
  minutesSinceMidnight,
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
});
