import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);

describe("legacy guest replacement", () => {
  it("replaces the hidden read-only guest form with Channel-only identity creation", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).not.toContain("GUEST_ACCESS_VISIBLE");
    expect(source).toContain("joinAsChannelIdentity");
    expect(source).toContain("创建 Channel-only 身份");
    expect(source).not.toContain("只读访问");
  });
});
