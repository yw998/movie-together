import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/016_channel_only_identities.sql", import.meta.url);
const rulesMigrationPath = new URL("../../db/migrations/017_group_identity_rules.sql", import.meta.url);
const functionPath = new URL("../../supabase/functions/channel-invitations/index.ts", import.meta.url);
const contextPath = new URL("../channels/ChannelIdentityContext.tsx", import.meta.url);
const mainViewPath = new URL("../channels/ChannelMainView.tsx", import.meta.url);

describe("Channel-only identities", () => {
  it("keeps identity credentials, sessions, and marks separate from auth users", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("create table channel_identities");
    expect(migration).toContain("create table channel_identity_sessions");
    expect(migration).toContain("create table channel_identity_marks");
    expect(migration).toContain("extensions.crypt(raw_code, extensions.gen_salt('bf', 10))");
    expect(migration).toContain("unique (identity_id, window_start, showing_id)");
    expect(migration).not.toMatch(/grant\s+.*channel_identities\s+to\s+(anon|authenticated)/i);
  });

  it("scopes every Channel-only write through a server-validated session", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("authenticate_channel_identity(session_token)");
    expect(migration).toContain("toggle_channel_identity_mark");
    expect(migration).toContain("create_channel_identity_invite_link");
    expect(migration).toContain("remove_channel_identity");
    expect(migration).toContain("delete_channel_as_identity");
    expect(migration).toContain("grant execute on function toggle_channel_identity_mark(text, date, text) to service_role");
  });

  it("atomically transfers membership, ownership, marks, links, and original timestamps to a personal account", async () => {
    const migration = await readFile(rulesMigrationPath, "utf8");

    expect(migration).toContain("merge_channel_identity_into_account");
    expect(migration).toContain("owner_user_id = target_user_id, owner_identity_id = null");
    expect(migration).toContain("least(public.watch_marks.created_at, excluded.created_at)");
    expect(migration).toContain("insert into public.channel_mark_shares");
    expect(migration).toContain("least(public.channel_mark_shares.created_at, excluded.created_at)");
    expect(migration).toContain("set created_by = target_user_id, created_by_identity = null");
    expect(migration).toContain("delete from public.channel_identities where id = identity_row.id");
  });

  it("revokes legacy guests but disables silent inactivity deletion", async () => {
    const [migration, rulesMigration] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(rulesMigrationPath, "utf8"),
    ]);

    expect(migration).toContain("update channel_guests set revoked_at = coalesce(revoked_at, now())");
    expect(rulesMigration).toContain("as $$ select 0 $$");
    expect(rulesMigration).toContain("cron.unschedule($1)");
    expect(rulesMigration).toContain("cleanup-channel-only-identities");
  });

  it("exposes the complete create, join, login, mark, management, and merge API", async () => {
    const source = await readFile(functionPath, "utf8");

    for (const action of [
      "identity_create_channel", "identity_join", "identity_login", "identity_session",
      "identity_toggle_mark", "identity_rotate_code", "identity_create_link",
      "identity_revoke_link", "identity_rename", "identity_transfer_owner",
      "identity_remove_member", "identity_leave",
      "identity_delete_channel", "identity_logout", "identity_merge",
    ]) expect(source).toContain(`action === "${action}"`);
    expect(source).not.toContain('action === "guest_join"');
    expect(source).not.toContain('action === "guest_access"');
  });

  it("stores the session and optional plaintext code only on the current device", async () => {
    const [context, mainView] = await Promise.all([
      readFile(contextPath, "utf8"),
      readFile(mainViewPath, "utf8"),
    ]);

    expect(context).toContain('localStorage.setItem(SESSION_KEY');
    expect(context).toContain('localStorage.setItem(`${CODE_KEY_PREFIX}');
    expect(context).toContain("toggleMark");
    expect(mainView).toContain("channelIdentity.toggleMark");
    expect(mainView).toContain("SHARED WATCHLIST");
  });
});
