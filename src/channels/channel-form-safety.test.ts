import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);
const stylesPath = new URL("../styles.css", import.meta.url);

describe("async channel forms", () => {
  it("captures form elements before awaiting Supabase calls", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source.match(/const formElement = event\.currentTarget/g)).toHaveLength(2);
    expect(source).not.toMatch(/await[\s\S]{0,500}event\.currentTarget\.reset\(\)/);
    expect(source.match(/formElement\.reset\(\)/g)).toHaveLength(2);
  });

  it("places copied-link feedback by the button and removes it after five seconds", async () => {
    const source = await readFile(componentPath, "utf8");
    const styles = await readFile(stylesPath, "utf8");

    expect(source).toContain('className="invite-copy-notice"');
    expect(source).toContain("}, 5000)");
    expect(source).toContain("window.clearTimeout(inviteCopyTimerRef.current)");
    expect(styles).toContain("animation: invite-copy-notice 5s ease forwards");
    expect(styles).toContain("0%, 78%");
  });
});
