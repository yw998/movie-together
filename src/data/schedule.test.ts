import { describe, expect, it } from "vitest";
import { rollingWindowFor } from "../lib/rolling-window";
import legacyData from "./legacy-schedule.json";
import { scheduleData, scheduleValidation } from "./schedule";

describe("approved public schedule", () => {
  it("loads a valid rolling seven-day official-source schedule", () => {
    const rollingWindow = rollingWindowFor(scheduleData.metadata.windowStart);
    expect(scheduleData.metadata).toMatchObject({
      timezone: "America/New_York",
      windowEnd: rollingWindow.end,
    });
    expect(scheduleData.metadata.refreshedLocalDate >= rollingWindow.start).toBe(true);
    expect(scheduleData.metadata.refreshedLocalDate <= rollingWindow.end).toBe(true);
    expect(scheduleData).not.toHaveProperty("dateLabels");
    expect(new Set(scheduleData.cinemas.map((cinema) => cinema.id)).size).toBe(
      scheduleData.cinemas.length,
    );
    expect(scheduleData.films.length).toBeGreaterThan(0);
    expect(scheduleData.showings.length).toBeGreaterThan(0);
    for (const showing of scheduleData.showings) {
      expect(showing.localDate >= rollingWindow.start).toBe(true);
      expect(showing.localDate <= rollingWindow.end).toBe(true);
    }
    expect(scheduleValidation).toMatchObject({
      errors: 0,
      warnings: 0,
      publishable: true,
    });
  });

  it("keeps every published showing traceable and reviewed", () => {
    for (const showing of scheduleData.showings) {
      expect(showing.sourceUrl).toMatch(/^https:\/\//);
      expect(["verified", "manual"]).toContain(showing.extractionStatus);
      expect(showing.fetchedAt).not.toBeNull();
      if (showing.fetchedAt === null) continue;
      expect(showing.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(Number.isNaN(Date.parse(showing.fetchedAt))).toBe(false);
    }
  });

  it("assigns unique IDs to every published session", () => {
    const ids = scheduleData.showings.map((showing) => showing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("historical prototype archive", () => {
  it("retains the recovered 409-showing source separately", () => {
    expect(legacyData.showings).toHaveLength(409);
  });
});
