import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const exportPath = new URL("../../scripts/db/export-published.ts", import.meta.url);
const workflowPath = new URL("../../.github/workflows/weekly-schedule.yml", import.meta.url);
const appPath = new URL("../App.tsx", import.meta.url);

describe("rolling seven-day publication", () => {
  it("exports approved showings by rolling local-date range instead of one current week", async () => {
    const source = await readFile(exportPath, "utf8");

    expect(source).toContain("s.local_date between ${rollingStart} and ${rollingEnd}");
    expect(source).toContain("join published_weeks pw on pw.window_start = s.window_start");
    expect(source).not.toContain("where pw.is_current = true");
  });

  it("runs daily and reviews every calendar week touched by the public window", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain('cron: "0 5 * * *"');
    expect(workflow).toContain("for WEEK_ANCHOR");
    expect(workflow).toContain("npm run review:schedule");
    expect(workflow).toContain("npm run db:verify-rolling");
  });

  it("labels the homepage as a future-seven-day view", async () => {
    const app = await readFile(appPath, "utf8");
    expect(app).toContain("未来七天看什么？");
  });
});

