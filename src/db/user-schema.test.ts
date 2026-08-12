import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/003_accounts_and_watch_marks.sql", import.meta.url);
const importPath = new URL("../../scripts/db/import-approved.ts", import.meta.url);
const exportPath = new URL("../../scripts/db/export-published.ts", import.meta.url);

describe("showing-level watch mark persistence", () => {
  it("uses an exact composite showing reference with owner-only RLS policies", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("foreign key (window_start, showing_id)");
    expect(migration).toContain("references showings(window_start, id) on delete restrict");
    expect(migration).toContain("alter table watch_marks enable row level security");
    expect(migration).toContain("with check ((select auth.uid()) = user_id)");
    expect(migration).not.toMatch(/grant\s+.+watch_marks\s+to\s+anon/i);
  });

  it("preserves old showing rows while exporting only the active publication", async () => {
    const importer = await readFile(importPath, "utf8");
    const exporter = await readFile(exportPath, "utf8");

    expect(importer).not.toMatch(/delete from showings/i);
    expect(importer).toContain("set publication_status = 'removed'");
    expect(importer).toContain("on conflict (window_start, id) do update set");
    expect(importer).toContain("publication_status = 'active'");
    expect(exporter.match(/publication_status = 'active'/g)).toHaveLength(2);
  });
});
