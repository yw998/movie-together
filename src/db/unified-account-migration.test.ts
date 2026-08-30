import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/023_unified_username_accounts.sql", import.meta.url);
const migratePath = new URL("../../scripts/db/migrate-unified-account-emails.mjs", import.meta.url);
const rollbackPath = new URL("../../scripts/db/restore-unified-account-emails.mjs", import.meta.url);

describe("unified account migration", () => {
  it("makes usernames immutable and permanently reserves deleted names", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("create table public.deleted_usernames");
    expect(migration).toContain("revoke update (username) on table public.profiles from authenticated");
    expect(migration).toContain("exists (select 1 from public.deleted_usernames");
    expect(migration).toContain("insert into public.deleted_usernames(username)");
  });

  it("stores only slow hashes for recovery codes and rate-limits auth attempts", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("extensions.crypt(recovery_code, extensions.gen_salt('bf', 12))");
    expect(migration).toContain("create function public.account_auth_guard");
    expect(migration).toContain("recent_ip < 30 and recent_account < 12");
    expect(migration).toContain("grant execute on function public.revoke_all_account_sessions(uuid) to service_role");
  });

  it("removes group identities, direct invitations, Friend IDs, and auto-share", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("drop table if exists public.channel_identities cascade");
    expect(migration).toContain("drop table if exists public.channel_invitations cascade");
    expect(migration).toContain("drop function if exists public.accept_channel_invite_link(text, boolean)");
    expect(migration).toContain("drop function if exists public.login_channel_identity(text, text, text)");
    expect(migration).toContain("alter table public.profiles drop column if exists friend_id");
    expect(migration).toContain("alter table public.channel_members drop column if exists auto_share_new_marks cascade");
  });

  it("creates an encrypted, paginated backup with a matching rollback utility", async () => {
    const [migrate, rollback] = await Promise.all([readFile(migratePath, "utf8"), readFile(rollbackPath, "utf8")]);
    expect(migrate).toContain('createCipheriv("aes-256-gcm"');
    expect(migrate).toContain("async function listAllUsers()");
    expect(migrate).toContain("deleteBy:");
    expect(rollback).toContain('createDecipheriv(');
    expect(rollback).toContain("backup.projectUrl !== url");
  });
});
