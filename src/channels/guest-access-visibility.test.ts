import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);

describe("legacy guest replacement", () => {
  it("offers a writable no-email group identity without legacy guest language", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).not.toContain("GUEST_ACCESS_VISIBLE");
    expect(source).toContain("joinAsChannelIdentity");
    expect(source).toContain("创建小组身份并加入");
    expect(source).not.toContain("只读访问");
    expect(source).not.toContain(">GUEST<");
  });
});
