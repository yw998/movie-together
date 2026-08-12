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

  it("places all invitation feedback by the button and removes it after three seconds", async () => {
    const source = await readFile(componentPath, "utf8");
    const styles = await readFile(stylesPath, "utf8");

    expect(source).toContain('className="invite-copy-notice"');
    expect(source).toContain('showInviteNotice(error ? "没有找到这个 Friend ID');
    expect(source).toContain('showInviteNotice("无法发送邮箱邀请。")');
    expect(source).toContain('showInviteNotice("无法生成邀请链接。")');
    expect(source).toContain("{inviteNotice.text}");
    expect(source).toContain("}, 3000)");
    expect(source).toContain("window.clearTimeout(inviteCopyTimerRef.current)");
    expect(styles).toContain("animation: invite-copy-notice 3s ease forwards");
    expect(styles).toContain("0%, 66%");
  });
});
