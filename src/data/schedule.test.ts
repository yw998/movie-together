import { describe, expect, it } from "vitest";
import legacyData from "./legacy-schedule.json";
import { scheduleData, scheduleValidation } from "./schedule";

describe("approved public schedule", () => {
  it("loads a valid Monday–Sunday official-source week", () => {
    expect(scheduleData.metadata).toMatchObject({
      windowStart: "2026-08-10",
      windowEnd: "2026-08-16",
      refreshedLocalDate: "2026-08-11",
    });
    expect(scheduleData.cinemas).toHaveLength(5);
    expect(scheduleData.films.length).toBeGreaterThan(0);
    expect(scheduleData.showings.length).toBeGreaterThan(0);
    expect(scheduleValidation).toMatchObject({ errors: 0, warnings: 0, publishable: true });
  });

  it("keeps every published showing traceable and reviewed", () => {
    for (const showing of scheduleData.showings) {
      expect(showing.sourceUrl).toMatch(/^https:\/\//);
      expect(["verified", "manual"]).toContain(showing.extractionStatus);
      expect(showing.fetchedAt).toMatch(/^2026-08-11T/);
    }
  });

  it("assigns unique IDs without dropping sold-out sessions", () => {
    const ids = scheduleData.showings.map((showing) => showing.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(scheduleData.showings.some((showing) => showing.availability === "sold_out")).toBe(true);
  });

  it("retains the evidence-backed Union County override", () => {
    expect(scheduleData.showings).toContainEqual(
      expect.objectContaining({
        id: "ifc-center-569494",
        localDate: "2026-08-14",
        localTime: "19:00",
        eventType: "qa",
        availability: "sold_out",
        extractionStatus: "manual",
      }),
    );
  });
});

describe("historical prototype archive", () => {
  it("retains the recovered 409-showing source separately", () => {
    expect(legacyData.showings).toHaveLength(409);
  });
});
