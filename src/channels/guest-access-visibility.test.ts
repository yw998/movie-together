import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);

describe("guest access visibility", () => {
  it("keeps both public guest entry points behind the disabled visibility flag", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain("const GUEST_ACCESS_VISIBLE = false");
    expect(source).toContain("{GUEST_ACCESS_VISIBLE && <button");
    expect(source).toContain("{GUEST_ACCESS_VISIBLE && !user && <form");
  });
});
