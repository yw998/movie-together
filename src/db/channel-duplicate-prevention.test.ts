import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/009_prevent_duplicate_channels.sql", import.meta.url);

describe("channel creation feedback safety", () => {
  it("serializes same-name creation and rejects an existing owner/name pair", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("owner_user_id = caller_id");
    expect(migration).toContain("lower(trim(name)) = lower(normalized_name)");
    expect(migration).toContain("errcode = 'unique_violation'");
  });
});
