import { readFile, writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../src/db/client";
import {
  DEFAULT_DESCRIPTION_MODEL,
  enrichWeeklyBundleDescriptions,
  generateBilingualDescriptions,
  parseManualFilmDescriptions,
  validateManualFilmDescriptionTargets,
  type CachedFilmDescription,
} from "../src/ingestion/ai-description-enrichment";
import type { WeeklyIngestionBundle } from "../src/ingestion/weekly-ingestion";

const [, , inputPath, outputPath, manualDescriptionPath = "data/manual-description-overrides.json"] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: npm run enrich:descriptions -- candidate.json enriched-candidate.json [manual-description-overrides.json]");
  process.exit(2);
}

const bundle = JSON.parse(await readFile(inputPath, "utf8")) as WeeklyIngestionBundle;
const manualDescriptions = parseManualFilmDescriptions(
  JSON.parse(await readFile(manualDescriptionPath, "utf8")) as unknown,
);
validateManualFilmDescriptionTargets(bundle, manualDescriptions);
const sql = createDatabaseClient();
try {
  const rows = await sql<{
    id: string;
    canonical_title: string;
    description_zh: string | null;
    description_en: string | null;
    description_source: string;
  }[]>`
    select id, canonical_title, description_zh, description_en, description_source
    from films
    where (description_zh is not null or description_en is not null)
      and description_source is not null
  `;
  const databaseCache = new Map<string, CachedFilmDescription>(rows.map((row) => [
    row.id,
    {
      canonicalTitle: row.canonical_title,
      descriptionZh: row.description_zh,
      descriptionEn: row.description_en,
      descriptionSource: row.description_source,
    },
  ]));
  const cache = new Map([...databaseCache, ...manualDescriptions]);
  let generatedCount = 0;
  const enriched = await enrichWeeklyBundleDescriptions(bundle, cache, {
    generate: async (evidence) => {
      generatedCount = evidence.length;
      return generateBilingualDescriptions(evidence, process.env.OPENAI_API_KEY ?? "", {
        model: process.env.OPENAI_DESCRIPTION_MODEL?.trim() || DEFAULT_DESCRIPTION_MODEL,
      });
    },
  });
  await writeFile(outputPath, `${JSON.stringify(enriched, null, 2)}\n`, { flag: "wx" });
  console.log(
    `Bilingual descriptions processed for ${new Set(enriched.adapters.flatMap((adapter) => adapter.films.map((film) => film.id))).size} films; generated ${generatedCount} new description pair(s).`,
  );
} finally {
  await sql.end();
}
