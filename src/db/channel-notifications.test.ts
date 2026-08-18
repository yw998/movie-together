import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/013_channel_notifications.sql", import.meta.url);
const parityMigrationPath = new URL("../../db/migrations/018_group_identity_notifications.sql", import.meta.url);
const identityQueryFixPath = new URL("../../db/migrations/020_fix_identity_notification_query.sql", import.meta.url);
const viewPath = new URL("../notifications/NotificationsView.tsx", import.meta.url);
const accountControlPath = new URL("../auth/AccountControl.tsx", import.meta.url);
const channelPanelPath = new URL("../channels/ChannelPanel.tsx", import.meta.url);

describe("channel reminders", () => {
  it("stores a private per-channel read cursor", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("create table channel_notification_reads");
    expect(migration).toContain("channel_notification_reads_select_own");
    expect(migration).toContain("user_id = (select auth.uid())");
    expect(migration).not.toMatch(/grant\s+delete\s+on\s+table\s+channel_notification_reads/i);
  });

  it("reports both account and no-email identity marks, grouped by exact showing", async () => {
    const migration = await readFile(parityMigrationPath, "utf8");
    expect(migration).toContain("members.user_id = auth.uid()");
    expect(migration).toContain("marks.user_id <> auth.uid()");
    expect(migration).toContain("channel_identity_marks");
    expect(migration).toContain("coalesce(reads.last_read_at, members.joined_at)");
    expect(migration).toContain("array_agg(distinct activity.actor_name");
    expect(migration).toContain("now() - interval '14 days'");
  });

  it("gives no-email identities a server-scoped read cursor and activity feed", async () => {
    const migration = await readFile(parityMigrationPath, "utf8");

    expect(migration).toContain("create table public.channel_identity_notification_reads");
    expect(migration).toContain("list_channel_identity_notifications(session_token text)");
    expect(migration).toContain("mark_channel_identity_notifications_read(session_token text)");
    expect(migration).toContain("authenticate_channel_identity(session_token)");
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(/grant\s+.*channel_identity_notification_reads\s+to\s+(anon|authenticated)/i);
  });

  it("allows identity session authentication to refresh activity during notification reads", async () => {
    const migration = await readFile(identityQueryFixPath, "utf8");
    expect(migration).toContain("alter function public.list_channel_identity_notifications(text) volatile");
  });

  it("keeps invitation acceptance and read acknowledgement explicit", async () => {
    const view = await readFile(viewPath, "utf8");
    expect(view).toContain('rpc("accept_channel_invitation"');
    expect(view).toContain('rpc("mark_my_channel_notifications_read"');
    expect(view).toContain("channelIdentity.markNotificationsRead()");
    expect(view).toContain('t("notifications.markAll")');
  });

  it("places the reminder bell beside either identity instead of in the Channel rail", async () => {
    const accountControl = await readFile(accountControlPath, "utf8");
    const channelPanel = await readFile(channelPanelPath, "utf8");

    expect(accountControl).toContain('className={`account-reminders');
    expect(accountControl).toContain("channelIdentity.unreadNotificationCount");
    expect(accountControl).toContain('<svg aria-hidden="true"');
    expect(channelPanel).not.toContain("channel-rail-reminders");
  });

  it("renders invitations and mark activity in one vertical card list", async () => {
    const view = await readFile(viewPath, "utf8");

    expect(view).toContain('className="notifications-list"');
    expect(view).not.toContain("notifications-section-title");
    expect(view).toContain('kind: "invitation"');
    expect(view).toContain('kind: "activity"');
  });
});
