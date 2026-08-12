import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const componentPath = new URL("./ChannelPanel.tsx", import.meta.url);

describe("channel member removal", () => {
  it("lets a registered channel owner remove account and Channel-only members", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain('member.role === "member"');
    expect(source).not.toContain('member.kind === "channel_only" && member.role === "member"');
    expect(source).toContain('client!.rpc("remove_channel_member"');
    expect(source).toContain('client!.rpc("remove_channel_identity_as_account"');
  });
});
