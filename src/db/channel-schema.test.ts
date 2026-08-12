import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/005_channels_and_invitations.sql", import.meta.url);

describe("channel membership and invitations", () => {
  it("uses owner/member roles and deny-by-default RLS", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("check (role in ('owner', 'member'))");
    expect(migration).toContain("alter table channels enable row level security");
    expect(migration).toContain("alter table channel_guests enable row level security");
    expect(migration).toContain("revoke all on table channel_members from anon, authenticated");
    expect(migration).not.toMatch(/grant\s+(insert|update|delete).+channel_members\s+to\s+authenticated/i);
  });

  it("stores only hashes and applies the confirmed link limits", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("token_hash bytea not null unique");
    expect(migration).toContain("access_code_hash bytea not null unique");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("max_uses integer not null default 20");
    expect(migration).toContain("extensions.digest(raw_token, 'sha256')");
    expect(migration).toContain("extensions.digest(raw_code, 'sha256')");
    expect(migration).not.toMatch(/\b(token|access_code)\s+text\s+not null/i);
  });

  it("keeps guest creation behind the service role", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("grant execute on function create_channel_guest(text, text) to service_role");
    expect(migration).not.toContain("grant execute on function create_channel_guest(text, text) to anon");
    expect(migration).not.toContain("grant execute on function create_channel_guest(text, text) to authenticated");
  });

  it("does not allow an owner to leave or remove themselves", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("The owner must delete the channel instead of leaving it.");
    expect(migration).toContain("The owner cannot remove themselves.");
  });
});
