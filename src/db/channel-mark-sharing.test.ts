import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/011_channel_watch_mark_sharing.sql", import.meta.url);
const cleanupMigrationPath = new URL("../../db/migrations/012_cleanup_shares_on_membership_removal.sql", import.meta.url);
const atomicMigrationPath = new URL("../../db/migrations/014_atomic_channel_watch_mark.sql", import.meta.url);

describe("channel watch-mark sharing", () => {
  it("keeps the personal mark as source data and shares through join rows", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("create table channel_mark_shares");
    expect(migration).toContain("foreign key (mark_id, shared_by)");
    expect(migration).toContain("references watch_marks(id, user_id) on delete cascade");
    expect(migration).toContain("shared_by = (select auth.uid())");
  });

  it("applies membership defaults while preserving per-mark selection", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("auto_share_new_marks boolean not null default false");
    expect(migration).toContain("create_watch_mark_with_defaults");
    expect(migration).toContain("set_watch_mark_channels");
    expect(migration).toContain("where user_id = caller_id and auto_share_new_marks");
  });

  it("exposes aggregated shared marks without granting edit rights", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("list_channel_shared_marks");
    expect(migration).toContain("grant select, insert, delete on table channel_mark_shares to authenticated");
    expect(migration).not.toMatch(/grant\s+update\s+on\s+table\s+channel_mark_shares/i);
    expect(migration).toContain("'sharedMarks'");
  });

  it("removes a departing member's shares without deleting the personal mark", async () => {
    const migration = await readFile(cleanupMigrationPath, "utf8");

    expect(migration).toContain("before delete on channel_members");
    expect(migration).toContain("delete from public.channel_mark_shares");
    expect(migration).not.toContain("delete from public.watch_marks");
  });

  it("adds a membership-checked atomic operation for marking within a Channel", async () => {
    const migration = await readFile(atomicMigrationPath, "utf8");

    expect(migration).toContain("create or replace function add_watch_mark_to_channel");
    expect(migration).toContain("Channel membership not found.");
    expect(migration).toContain("insert into public.watch_marks");
    expect(migration).toContain("insert into public.channel_mark_shares");
    expect(migration).toContain("grant execute on function add_watch_mark_to_channel(date, text, uuid) to authenticated");
  });
});
