import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/017_group_identity_rules.sql", import.meta.url);
const identityPanelPath = new URL("../channels/ChannelIdentityPanel.tsx", import.meta.url);
const accountPanelPath = new URL("../channels/ChannelPanel.tsx", import.meta.url);
const accountControlPath = new URL("../auth/AccountControl.tsx", import.meta.url);
const identityContextPath = new URL("../channels/ChannelIdentityContext.tsx", import.meta.url);
const channelApiPath = new URL("../channels/channel-api.ts", import.meta.url);
const accountEventsPath = new URL("../auth/account-events.ts", import.meta.url);

describe("group identity rules", () => {
  it("gives both owner kinds the same core management boundary", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("rename_channel(target_channel_id uuid, new_name text)");
    expect(migration).toContain("rename_channel_as_identity(session_token text, new_name text)");
    expect(migration).toContain("transfer_channel_ownership(");
    expect(migration).toContain("transfer_channel_ownership_as_identity(");
    expect(migration).toContain("remove_channel_participant_as_identity(");
    expect(migration).toContain("target_kind = 'account'");
    expect(migration).toContain("target_kind = 'channel_only'");
  });

  it("keeps invite links with the group across owner changes and upgrades", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("on delete set null");
    expect(migration).toContain("num_nonnulls(created_by, created_by_identity) <= 1");
    expect(migration).toContain("where links.channel_id = channels.id");
    expect(migration).not.toContain("where links.channel_id = channels.id and links.created_by_identity = identities.id");
  });

  it("exposes rename, transfer, removal, link revocation, and automatic upgrade UI", async () => {
    const [identityPanel, accountPanel, accountControl] = await Promise.all([
      readFile(identityPanelPath, "utf8"),
      readFile(accountPanelPath, "utf8"),
      readFile(accountControlPath, "utf8"),
    ]);

    expect(identityPanel).toContain("channelIdentity.renameChannel");
    expect(identityPanel).toContain('className="channel-title-row"');
    expect(identityPanel).toContain('className="channel-rename"');
    expect(identityPanel).toContain("channelIdentity.transferOwnership");
    expect(identityPanel).toContain('t("identity.makeOrganizer")');
    expect(identityPanel).not.toContain("创建者");
    expect(identityPanel).not.toContain("createAnotherChannel");
    expect(accountPanel).toContain('client!.rpc("rename_channel"');
    expect(accountPanel).toContain('className="channel-title-row"');
    expect(accountPanel).toContain('className="channel-rename"');
    expect(accountPanel).toContain('client!.rpc("transfer_channel_ownership"');
    expect(accountPanel).toContain('copy("设为组长", "Make Organizer")');
    expect(accountPanel).not.toContain("创建者");
    expect(accountPanel).toContain('client!.rpc("revoke_channel_invite_link"');
    expect(accountControl).toContain("IDENTITY_UPGRADE_PENDING_KEY");
    expect(accountControl).toContain("channelIdentity.mergeIntoAccount()");
  });

  it("shows newly issued invite credentials only after identity state is available", async () => {
    const [accountPanel, accountControl, accountEvents] = await Promise.all([
      readFile(accountPanelPath, "utf8"),
      readFile(accountControlPath, "utf8"),
      readFile(accountEventsPath, "utf8"),
    ]);

    expect(accountPanel).toContain("requestIdentityCredentialsDialog()");
    expect(accountEvents).toContain("IDENTITY_CREDENTIALS_PENDING_KEY");
    expect(accountControl).toContain("请立即复制并保存小组编号和个人代码");
    expect(accountControl).toContain('setMode("channel_identity")');
  });

  it("merges with the explicit authenticated access token and keeps a retry path", async () => {
    const [identityContext, channelApi, accountControl] = await Promise.all([
      readFile(identityContextPath, "utf8"),
      readFile(channelApiPath, "utf8"),
      readFile(accountControlPath, "utf8"),
    ]);

    expect(identityContext).toContain("supabase.auth.getSession()");
    expect(identityContext).toContain("accessToken");
    expect(channelApi).toContain("Authorization: `Bearer ${accessToken}`");
    expect(accountControl).toContain("完成小组身份升级");
    expect(accountControl).toContain("小组身份和原凭证仍然安全");
  });
});
