import { describe, expect, it } from "vitest";
import { formatWindowYears, formatWindowZh } from "./date-display";

describe("schedule window display", () => {
  it("formats same-month windows compactly", () => {
    expect(formatWindowZh("2026-08-11", "2026-08-17")).toBe("8 月 11–17 日");
    expect(formatWindowYears("2026-08-11", "2026-08-17")).toBe("2026");
  });
  it("retains month and year boundaries", () => {
    expect(formatWindowZh("2026-08-29", "2026-09-04")).toBe("8 月 29 日–9 月 4 日");
    expect(formatWindowZh("2026-12-29", "2027-01-04")).toBe("2026 年 12 月 29 日–2027 年 1 月 4 日");
    expect(formatWindowYears("2026-12-29", "2027-01-04")).toBe("2026–2027");
  });
});
