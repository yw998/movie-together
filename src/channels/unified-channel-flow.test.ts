import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const panelPath = new URL("./ChannelPanel.tsx", import.meta.url);
const viewPath = new URL("./ChannelMainView.tsx", import.meta.url);
const migrationPath = new URL("../../db/migrations/023_unified_username_accounts.sql", import.meta.url);

describe("account-only Film Fams", () => {
  it("offers only permanent, revocable invitation links", async () => {
    const [panel, migration] = await Promise.all([readFile(panelPath, "utf8"), readFile(migrationPath, "utf8")]);
    expect(panel).toContain('rpc("create_channel_invite_link"');
    expect(panel).toContain('rpc("revoke_channel_invite_link"');
    expect(panel).toContain("The link remains valid until you revoke or replace it.");
    expect(panel).toContain('copy("复制邀请", "Copy invitation")');
    expect(panel).toContain("invitationMessage({");
    expect(panel).not.toContain("Friend ID");
    expect(panel).not.toContain('name="email"');
    expect(migration).toContain("drop column if exists expires_at cascade");
    expect(migration).toContain("drop column if exists max_uses cascade");
  });

  it("previews member count and requires a separate join confirmation", async () => {
    const panel = await readFile(panelPath, "utf8");
    expect(panel).toContain("invitePreview.memberCount");
    expect(panel).toContain("Confirm and join");
    expect(panel).toContain('rpc("accept_channel_invite_link"');
  });

  it("keeps homepage marks private and shares a me-too mark into the current group", async () => {
    const [view, migration] = await Promise.all([readFile(viewPath, "utf8"), readFile(migrationPath, "utf8")]);
    expect(view).toContain("watchMarks.addToChannel(activity.showingId, channelId)");
    expect(migration).toContain("New marks are always private");
    expect(migration).toContain("create_watch_mark_with_defaults");
    expect(migration).not.toContain("insert into public.channel_mark_shares(mark_id");
  });

  it("supports owner transfer, member removal, leaving, and group deletion", async () => {
    const panel = await readFile(panelPath, "utf8");
    for (const rpc of ["transfer_channel_ownership", "remove_channel_member", "leave_channel", "delete_channel"]) {
      expect(panel).toContain(`rpc("${rpc}"`);
    }
  });

  it("keeps the established circular Film Fam rail structure", async () => {
    const panel = await readFile(panelPath, "utf8");
    expect(panel).toContain('className="channel-rail-nav"');
    expect(panel).toContain("channel-rail-home");
    expect(panel).toContain('className="channel-rail-divider"');
    expect(panel).toContain('className="channel-rail-list"');
    expect(panel).toContain('className="channel-rail-create"');
    expect(panel).toContain('activeChannelId || mobileOpen ? " context-open"');
    expect(panel).not.toContain('className="channel-rail"');
  });
});
