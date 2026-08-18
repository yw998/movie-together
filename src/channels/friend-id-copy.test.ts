import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);

describe("Friend ID copy control", () => {
  it("copies only a loaded Friend ID and reports success or failure", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain("navigator.clipboard.writeText(friendId)");
    expect(source).toContain('disabled={!friendId}');
    expect(source).toContain('friendIdCopied ? copy("已复制", "Copied") : copy("复制", "Copy")');
    expect(source).toContain("无法复制 Friend ID");
    expect(source).toContain("friendIdCopyTimerRef.current = window.setTimeout");
    expect(source).toContain("}, 3000)");
  });

  it("shows the personal Friend ID and copy control in the Channel creation dialog", async () => {
    const source = await readFile(componentPath, "utf8");
    const createDialog = source.slice(
      source.indexOf('<dialog className="channel-create-dialog"'),
      source.indexOf('<dialog className="auth-dialog invite-dialog"'),
    );

    expect(createDialog).toContain('className="channel-create-friend-id"');
    expect(createDialog).toContain("个人 Friend ID");
    expect(createDialog).toContain('{friendId ?? copy("读取中…", "Loading…")}');
    expect(createDialog).toContain('onClick={() => void copyFriendId()}');
    expect(createDialog).toContain('disabled={!friendId}');
  });
});
