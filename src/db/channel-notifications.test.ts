import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/013_channel_notifications.sql", import.meta.url);
const viewPath = new URL("../notifications/NotificationsView.tsx", import.meta.url);

describe("channel reminders", () => {
  it("stores a private per-channel read cursor", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("create table channel_notification_reads");
    expect(migration).toContain("channel_notification_reads_select_own");
    expect(migration).toContain("user_id = (select auth.uid())");
    expect(migration).not.toMatch(/grant\s+delete\s+on\s+table\s+channel_notification_reads/i);
  });

  it("only reports other members' shared marks in joined channels", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("members.user_id = auth.uid()");
    expect(migration).toContain("shares.shared_by <> auth.uid()");
    expect(migration).toContain("coalesce(reads.last_read_at, members.joined_at)");
    expect(migration).toContain("now() - interval '30 days'");
  });

  it("keeps invitation acceptance and read acknowledgement explicit", async () => {
    const view = await readFile(viewPath, "utf8");
    expect(view).toContain('rpc("accept_channel_invitation"');
    expect(view).toContain('rpc("mark_my_channel_notifications_read"');
    expect(view).toContain("全部标为已读");
  });
});
