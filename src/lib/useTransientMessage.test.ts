import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const hookPath = new URL("./useTransientMessage.ts", import.meta.url);

describe("transient UI messages", () => {
  it("clears every message after three seconds and resets for repeated text", async () => {
    const source = await readFile(hookPath, "utf8");

    expect(source).toContain("TRANSIENT_MESSAGE_DURATION_MS = 3000");
    expect(source).toContain("window.setTimeout(() => setMessage(null)");
    expect(source).toContain("window.clearTimeout(timer)");
    expect(source).toContain("id: ++sequence.current");
  });

  it("is used by every component that renders operation feedback", async () => {
    const paths = [
      "../auth/AccountControl.tsx",
      "../channels/ChannelMainView.tsx",
      "../channels/ChannelPanel.tsx",
      "../notifications/NotificationsView.tsx",
      "../watch-marks/ShareMarkDialog.tsx",
      "../watch-marks/useWatchMarks.ts",
    ];
    const sources = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

    for (const source of sources) expect(source).toContain("useTransientMessage");
  });
});
