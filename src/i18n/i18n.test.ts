import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatWindow } from "../lib/date-display";
import { browserLocale, isLocale } from "./locales";
import { enUS, zhCN } from "./messages";

describe("bilingual interface contracts", () => {
  it("keeps every Chinese and English message key in sync", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
    expect(Object.values(enUS).every((message) => message.trim().length > 0)).toBe(true);
  });

  it("uses Chinese browsers when available and otherwise defaults to English", () => {
    expect(browserLocale(["zh-Hant-TW", "en-US"])).toBe("zh-CN");
    expect(browserLocale(["en-US", "zh-CN"])).toBe("en-US");
    expect(browserLocale(["fr-FR", "es-ES"])).toBe("en-US");
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("en-US")).toBe(true);
    expect(isLocale("en-GB")).toBe(false);
  });

  it("formats presentation dates without storing localized schedule facts", () => {
    expect(formatCalendarDate("2026-08-17", "zh-CN")).toContain("8");
    expect(formatCalendarDate("2026-08-17", "en-US")).toBe("Mon, Aug 17");
    expect(formatWindow("2026-08-17", "2026-08-23", "en-US")).toBe("Aug 17–Aug 23");
  });
});
