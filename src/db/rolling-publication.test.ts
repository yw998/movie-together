import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const exportPath = new URL("../../scripts/db/export-published.ts", import.meta.url);
const workflowPath = new URL("../../.github/workflows/weekly-schedule.yml", import.meta.url);
const appPath = new URL("../App.tsx", import.meta.url);
const messagesPath = new URL("../i18n/messages.ts", import.meta.url);

describe("rolling seven-day publication", () => {
  it("exports the one current approved rolling window", async () => {
    const source = await readFile(exportPath, "utf8");

    expect(source).toContain("s.local_date between ${rollingStart} and ${rollingEnd}");
    expect(source).toContain("join published_weeks pw on pw.window_start = s.window_start");
    expect(source).toContain("pw.is_current = true");
  });

  it("runs daily and reviews one exact rolling window", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain('cron: "0 5 * * *"');
    expect(workflow).toContain("npm run ingest:rolling");
    expect(workflow).not.toContain("for WEEK_ANCHOR");
    expect(workflow).toContain("npm run review:schedule");
    expect(workflow).toContain("npm run db:verify-rolling");
  });

  it("labels the homepage as a future-seven-day view", async () => {
    const [app, messages] = await Promise.all([readFile(appPath, "utf8"), readFile(messagesPath, "utf8")]);
    expect(app).toContain('t("hero.title")');
    expect(messages).toContain("这周看什么？");
    expect(messages).toContain("So, What Are We Watching?");
  });
});
