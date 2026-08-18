import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/021_profile_locale_and_bilingual_descriptions.sql", import.meta.url);
const importPath = new URL("../../scripts/db/import-approved.ts", import.meta.url);
const exportPath = new URL("../../scripts/db/export-published.ts", import.meta.url);
const enrichmentPath = new URL("../../scripts/enrich-descriptions.ts", import.meta.url);

describe("bilingual persistence", () => {
  it("stores a constrained account locale and grants only the required update column", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("preferred_locale text");
    expect(migration).toContain("preferred_locale in ('zh-CN', 'en-US')");
    expect(migration).toContain("grant update (preferred_locale)");
  });

  it("round-trips English descriptions through durable storage", async () => {
    const [migration, importer, exporter] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(importPath, "utf8"),
      readFile(exportPath, "utf8"),
    ]);
    expect(migration).toContain("description_en text");
    expect(importer).toContain("description_zh, description_en, description_source");
    expect(importer).toContain("description_en = excluded.description_en");
    expect(exporter).toContain("descriptionEn: row.description_en");
  });

  it("loads English-only and partial cached descriptions for targeted retries", async () => {
    const enrichment = await readFile(enrichmentPath, "utf8");
    expect(enrichment).toContain("description_zh is not null or description_en is not null");
    expect(enrichment).toContain("descriptionEn: row.description_en");
  });
});
