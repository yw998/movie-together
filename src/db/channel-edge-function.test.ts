import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const functionPath = new URL("../../supabase/functions/channel-invitations/index.ts", import.meta.url);
const migrationPath = new URL("../../db/migrations/007_trusted_channel_invitation_endpoints.sql", import.meta.url);

describe("trusted channel invitation endpoint", () => {
  it("keeps secret-key work inside the Edge Function", async () => {
    const source = await readFile(functionPath, "utf8");

    expect(source).toContain('readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")');
    expect(source).toContain('userClient.auth.getUser()');
    expect(source).toContain('action === "guest_join"');
    expect(source).toContain('action === "guest_access"');
    expect(source).not.toContain("console.log");
  });

  it("rate-limits guest joins and code attempts in server-only tables", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("channel_guest_access_attempts");
    expect(migration).toContain("channel_guest_join_attempts");
    expect(migration).toContain("count(*) >= 5");
    expect(migration).toContain("count(*) >= 10");
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toContain("from public, anon, authenticated");
  });
});
