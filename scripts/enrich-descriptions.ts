import { readFile, writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../src/db/client";
import {
  DEFAULT_DESCRIPTION_MODEL,
  enrichWeeklyBundleDescriptions,
  generateBilingualDescriptions,
  generateBilingualDescriptionsInBatches,
  parseManualFilmDescriptions,
  validEnglishDescription,
  validateManualFilmDescriptionTargets,
  type CachedFilmDescription,
  type DescriptionGenerationBatchSummary,
} from "../src/ingestion/ai-description-enrichment";
import type { WeeklyIngestionBundle } from "../src/ingestion/weekly-ingestion";

const [, , inputPath, outputPath, manualDescriptionPath = "data/manual-description-overrides.json"] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: npm run enrich:descriptions -- candidate.json enriched-candidate.json [manual-description-overrides.json]");
  process.exit(2);
}

const bundle = JSON.parse(await readFile(inputPath, "utf8")) as WeeklyIngestionBundle;
const reportPath = outputPath.endsWith(".json")
  ? outputPath.replace(/\.json$/u, ".report.json")
  : `${outputPath}.report.json`;
const generationEnabled = process.env.DESCRIPTION_GENERATION_MODE !== "cache-only";
const requireGenerationSuccess = process.env.REQUIRE_DESCRIPTION_GENERATION_SUCCESS === "true";
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
      descriptionEn: row.description_en && validEnglishDescription(row.description_en) ? row.description_en : null,
      descriptionSource: row.description_source,
    },
  ]));
  const cache = new Map([...databaseCache, ...manualDescriptions]);
  const generationState: { summary: DescriptionGenerationBatchSummary | null } = { summary: null };
  const enriched = await enrichWeeklyBundleDescriptions(bundle, cache, {
    generate: generationEnabled
      ? async (evidence) => {
          generationState.summary = await generateBilingualDescriptionsInBatches(
            evidence,
            (batch) => generateBilingualDescriptions(batch, process.env.OPENAI_API_KEY ?? "", {
              model: process.env.OPENAI_DESCRIPTION_MODEL?.trim() || DEFAULT_DESCRIPTION_MODEL,
            }),
          );
          return generationState.summary.decisions;
        }
      : undefined,
  });
  await writeFile(outputPath, `${JSON.stringify(enriched, null, 2)}\n`, { flag: "wx" });
  const generationSummary = generationState.summary;
  const report = {
    totalFilms: new Set(enriched.adapters.flatMap((adapter) => adapter.films.map((film) => film.id))).size,
    generationMode: generationEnabled ? "generate" : "cache-only",
    generation: generationSummary,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(`Description enrichment report: ${JSON.stringify(report)}`);
  if (
    requireGenerationSuccess &&
    generationSummary &&
    generationSummary.attemptedFilms > 0 &&
    generationSummary.technicalFailureFilms === generationSummary.attemptedFilms
  ) {
    throw new Error(
      `All ${generationSummary.attemptedFilms} attempted description generations failed technically; no descriptions were imported.`,
    );
  }
} finally {
  await sql.end();
}
