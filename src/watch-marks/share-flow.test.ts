import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const appPath = new URL("../App.tsx", import.meta.url);
const hookPath = new URL("./useWatchMarks.ts", import.meta.url);
const dialogPath = new URL("./ShareMarkDialog.tsx", import.meta.url);

describe("personal mark and channel share flow", () => {
  it("creates the personal mark before opening the share dialog", async () => {
    const hook = await readFile(hookPath, "utf8");
    const app = await readFile(appPath, "utf8");

    expect(hook).toContain('rpc("create_watch_mark_with_defaults"');
    expect(hook).toContain('action: "created", markId');
    expect(app).toContain('result?.action === "created"');
    expect(app).toContain("setSharePrompt");
  });

  it("keeps dismissal separate from deletion and saves explicit channels", async () => {
    const dialog = await readFile(dialogPath, "utf8");

    expect(dialog).toContain("关闭这里不会取消标记");
    expect(dialog).toContain("onSaved(channelIds)");
    expect(dialog).not.toContain('.from("watch_marks").delete');
  });

  it("provides a week-wide personal view and share counts", async () => {
    const app = await readFile(appPath, "utf8");

    expect(app).toContain('scheduleView === "personal" || showing.localDate === selectedDate');
    expect(app).toContain('scheduleView === "personal" ? "个人主视图"');
    expect(app).toContain("已分享至 ${shareCount} 个 Channel");
  });
});
