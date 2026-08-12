import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);

describe("async channel forms", () => {
  it("captures form elements before awaiting Supabase calls", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source.match(/const formElement = event\.currentTarget/g)).toHaveLength(2);
    expect(source).not.toMatch(/await[\s\S]{0,500}event\.currentTarget\.reset\(\)/);
    expect(source.match(/formElement\.reset\(\)/g)).toHaveLength(2);
  });
});
