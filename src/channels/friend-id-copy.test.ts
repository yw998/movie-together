import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);

describe("Friend ID copy control", () => {
  it("copies only a loaded Friend ID and reports success or failure", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain("navigator.clipboard.writeText(friendId)");
    expect(source).toContain('disabled={!friendId}');
    expect(source).toContain('friendIdCopied ? "已复制" : "复制"');
    expect(source).toContain("无法复制 Friend ID");
  });
});
