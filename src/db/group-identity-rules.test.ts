import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/017_group_identity_rules.sql", import.meta.url);
const identityPanelPath = new URL("../channels/ChannelIdentityPanel.tsx", import.meta.url);
const accountPanelPath = new URL("../channels/ChannelPanel.tsx", import.meta.url);
const accountControlPath = new URL("../auth/AccountControl.tsx", import.meta.url);

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
    expect(identityPanel).toContain("channelIdentity.transferOwnership");
    expect(identityPanel).not.toContain("createAnotherChannel");
    expect(accountPanel).toContain('client!.rpc("rename_channel"');
    expect(accountPanel).toContain('client!.rpc("transfer_channel_ownership"');
    expect(accountPanel).toContain('client!.rpc("revoke_channel_invite_link"');
    expect(accountControl).toContain("IDENTITY_UPGRADE_PENDING_KEY");
    expect(accountControl).toContain("channelIdentity.mergeIntoAccount()");
  });
});
