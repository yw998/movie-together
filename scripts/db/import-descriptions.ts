import { readFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";
import { validEnglishDescription } from "../../src/ingestion/ai-description-enrichment";
import type { WeeklyIngestionBundle } from "../../src/ingestion/weekly-ingestion";
import type { Film } from "../../src/types/schedule";

const [, , candidatePath] = process.argv;
if (!candidatePath) {
  console.error("Usage: npm run db:import-descriptions -- enriched-candidate.json");
  process.exit(2);
}

const candidate = JSON.parse(await readFile(candidatePath, "utf8")) as WeeklyIngestionBundle;
const films = new Map<string, Film>();
for (const adapter of candidate.adapters) {
  for (const film of adapter.films) {
    const existing = films.get(film.id);
    if (existing && existing.canonicalTitle !== film.canonicalTitle) {
      throw new Error(`Candidate contains conflicting titles for ${film.id}.`);
    }
    films.set(film.id, film);
  }
}

const sql = createDatabaseClient();
try {
  let updated = 0;
  await sql.begin(async (transaction) => {
    for (const film of films.values()) {
      const descriptionEn = film.descriptionEn && validEnglishDescription(film.descriptionEn)
        ? film.descriptionEn
        : null;
      const rows = await transaction<{ id: string }[]>`
        update films
        set description_zh = coalesce(${film.descriptionZh}::text, description_zh),
            description_en = ${descriptionEn}::text,
            description_source = case
              when coalesce(${film.descriptionZh}::text, description_zh) is null
                and ${descriptionEn}::text is null then null
              else coalesce(${film.descriptionSource}::text, description_source)
            end
        where id = ${film.id}::text
        returning id
      `;
      if (rows.length !== 1) throw new Error(`Description target ${film.id} does not exist in the database.`);
      updated += 1;
    }
  });
  console.log(`Updated descriptions for ${updated} existing film(s); no schedule facts were changed.`);
} finally {
  await sql.end();
}
