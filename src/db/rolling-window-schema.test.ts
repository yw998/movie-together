import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rolling-window database contract", () => {
  it("allows rolling ingestion runs and stores omitted cinema-dates", () => {
    const migration = readFileSync("db/migrations/022_rolling_windows_and_availability.sql", "utf8");
    expect(migration).toContain("rolling_seven_days");
    expect(migration).toContain("unavailable_cinema_dates jsonb");
  });

  it("imports the entire rolling window in one approved transaction", () => {
    const workflow = readFileSync(".github/workflows/weekly-schedule.yml", "utf8");
    expect(workflow.match(/npm run db:import --/g)).toHaveLength(1);
    expect(workflow).toContain("npm run ingest:rolling");
    expect(workflow).not.toContain("WEEK_ANCHORS");
  });
});
