import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/010_friend_id_and_email_invitations_only.sql", import.meta.url);
const componentPath = new URL("../channels/ChannelPanel.tsx", import.meta.url);

describe("registered-user invitation methods", () => {
  it("allows Friend ID invitations and revokes the old generic RPC", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("invite_channel_user_by_friend_id");
    expect(migration).toContain("where friend_id = upper(trim(target_friend_id))");
    expect(migration).toContain("revoke execute on function invite_channel_user(uuid, text, text) from authenticated");
    expect(migration).toContain("insert into public.channel_invitations");
    expect(migration).not.toContain("insert into public.channel_members");
  });

  it("offers only Friend ID and email in the UI", async () => {
    const component = await readFile(componentPath, "utf8");

    expect(component).toContain('<option value="friend_id">Friend ID</option>');
    expect(component).toContain('<option value="email">{copy("邮箱", "Email")}</option>');
    expect(component).not.toContain('<option value="username">');
    expect(component).toContain("等待对方接受后才会加入");
  });
});
