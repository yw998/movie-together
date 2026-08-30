import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const runnerPath = new URL("../../scripts/db/migrate.ts", import.meta.url);
const migrationPath = new URL("../../db/migrations/023_unified_username_accounts.sql", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);

describe("manual unified-account cutover", () => {
  it("keeps the destructive account migration out of automatic schedule runs", async () => {
    const [runner, migration, packageJson] = await Promise.all([
      readFile(runnerPath, "utf8"),
      readFile(migrationPath, "utf8"),
      readFile(packagePath, "utf8"),
    ]);
    expect(migration.startsWith("-- migration-mode: manual")).toBe(true);
    expect(runner).toContain('process.argv.includes("--include-manual")');
    expect(runner).toContain("deferredManualMigration = file");
    expect(packageJson).toContain('"db:migrate:account-schema"');
  });
});
