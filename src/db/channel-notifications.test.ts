import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const baseMigrationPath = new URL("../../db/migrations/013_channel_notifications.sql", import.meta.url);
const unifiedMigrationPath = new URL("../../db/migrations/023_unified_username_accounts.sql", import.meta.url);
const viewPath = new URL("../notifications/NotificationsView.tsx", import.meta.url);
const accountPath = new URL("../auth/AccountControl.tsx", import.meta.url);

describe("account-only Film Fam reminders", () => {
  it("stores a private per-account, per-group read cursor", async () => {
    const migration = await readFile(baseMigrationPath, "utf8");
    expect(migration).toContain("create table channel_notification_reads");
    expect(migration).toContain("user_id = (select auth.uid())");
  });

  it("reports only account shares grouped by exact showing", async () => {
    const migration = await readFile(unifiedMigrationPath, "utf8");
    expect(migration).toContain("marks.user_id <> auth.uid()");
    expect(migration).toContain("array_agg(distinct profiles.username order by profiles.username)");
    expect(migration).toContain("now() - interval '14 days'");
    expect(migration).not.toContain("channel_identity_marks marks");
  });

  it("renders activity only and keeps explicit read acknowledgement", async () => {
    const [view, account] = await Promise.all([readFile(viewPath, "utf8"), readFile(accountPath, "utf8")]);
    expect(view).toContain('rpc("mark_my_channel_notifications_read"');
    expect(view).toContain('className="notifications-list"');
    expect(view).not.toContain('kind: "invitation"');
    expect(account).toContain('className={`account-reminders');
  });
});
