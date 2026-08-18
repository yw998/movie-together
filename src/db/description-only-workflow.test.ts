import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("description-only publication", () => {
  it("limits the database importer to film description columns", () => {
    const importer = readFileSync("scripts/db/import-descriptions.ts", "utf8");
    expect(importer).toContain("update films");
    expect(importer).toContain("description_en");
    expect(importer).not.toMatch(/update\s+showings/i);
    expect(importer).not.toMatch(/insert\s+into\s+showings/i);
    expect(importer).not.toMatch(/published_weeks/);
  });

  it("commits only the public JSON from the backfill workflow", () => {
    const workflow = readFileSync(".github/workflows/description-backfill.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("env.PUBLISH == 'true'");
    expect(workflow).toContain("git add src/data/published-schedule.json");
    expect(workflow).not.toContain("schedule:");
  });
});
