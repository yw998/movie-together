import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/015_invitation_share_existing_marks.sql", import.meta.url);
const notificationsPath = new URL("../notifications/NotificationsView.tsx", import.meta.url);
const panelPath = new URL("../channels/ChannelPanel.tsx", import.meta.url);
const apiPath = new URL("../channels/channel-api.ts", import.meta.url);

describe("channel invitation acceptance", () => {
  it("optionally shares all existing personal marks in the acceptance transaction", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("accept_channel_invitation(\n  target_invitation_id uuid,\n  share_existing_marks boolean");
    expect(migration).toContain("accept_channel_invite_link(\n  invite_token text,\n  share_existing_marks boolean");
    expect(migration.match(/if coalesce\(share_existing_marks, false\) then/g)).toHaveLength(2);
    expect(migration.match(/from public\.watch_marks marks/g)).toHaveLength(2);
    expect(migration.match(/where marks\.user_id = auth\.uid\(\)/g)).toHaveLength(2);
  });

  it("offers the private-by-default choice for direct and link invitations", async () => {
    const [notifications, panel] = await Promise.all([
      readFile(notificationsPath, "utf8"),
      readFile(panelPath, "utf8"),
    ]);

    expect(notifications).toContain('t("notifications.shareExisting")');
    expect(notifications).toContain('t("notifications.shareLater")');
    expect(notifications).toContain("share_existing_marks:");
    expect(panel).toContain("同步现有的全部个人标记");
    expect(panel).toContain("以后可逐条手动分享");
    expect(panel).toContain("useState(false)");
  });

  it("notifies the Channel rail immediately after either acceptance flow", async () => {
    const [notifications, panel, api] = await Promise.all([
      readFile(notificationsPath, "utf8"),
      readFile(panelPath, "utf8"),
      readFile(apiPath, "utf8"),
    ]);

    expect(api).toContain('CHANNELS_CHANGED_EVENT = "movie-together:channels-changed"');
    expect(notifications).toContain("notifyChannelsChanged();");
    expect(panel).toContain("window.addEventListener(CHANNELS_CHANGED_EVENT, load)");
    expect(panel).toContain("notifyChannelsChanged();");
  });
});
