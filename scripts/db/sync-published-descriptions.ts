import { readFile, rename, writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";
import { synchronizePublishedDescriptions, type StoredFilmDescription } from "../../src/data/description-sync";
import { validEnglishDescription } from "../../src/ingestion/ai-description-enrichment";
import { validateScheduleData } from "../../src/lib/schedule-validation";
import type { ScheduleData } from "../../src/types/schedule";

const [, , publishedPath] = process.argv;
if (!publishedPath) {
  console.error("Usage: npm run db:sync-published-descriptions -- published-schedule.json");
  process.exit(2);
}

const original = JSON.parse(await readFile(publishedPath, "utf8")) as ScheduleData;
const sql = createDatabaseClient();
try {
  const rows = await sql<{
    id: string;
    description_zh: string | null;
    description_en: string | null;
    description_source: string | null;
  }[]>`
    select id, description_zh, description_en, description_source
    from films
    where id = any(${original.films.map((film) => film.id)})
  `;
  const descriptions: StoredFilmDescription[] = rows.map((row) => ({
    id: row.id,
    descriptionZh: row.description_zh,
    descriptionEn: row.description_en && validEnglishDescription(row.description_en) ? row.description_en : null,
    descriptionSource: row.description_source,
  }));
  const result = synchronizePublishedDescriptions(original, descriptions);
  const validation = validateScheduleData(result.schedule, { staleAfterHours: Number.POSITIVE_INFINITY });
  if (validation.errors > 0) {
    throw new Error(`Description-only synchronization failed validation: ${validation.issues.map((issue) => issue.message).join(" ")}`);
  }

  const temporaryPath = `${publishedPath}.descriptions.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(result.schedule, null, 2)}\n`, { flag: "w" });
  await rename(temporaryPath, publishedPath);
  console.log(
    `Synchronized descriptions: ${result.stats.changedFilms} film(s) changed, ` +
    `${result.stats.addedChinese} Chinese and ${result.stats.addedEnglish} English description(s) added.`,
  );
} finally {
  await sql.end();
}
