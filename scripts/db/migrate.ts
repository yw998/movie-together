import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient } from "../../src/db/client";

const migrationsDirectory = resolve("db/migrations");
const manualMigrationMarker = "-- migration-mode: manual";
const includeManualMigrations = process.argv.includes("--include-manual");
const sql = createDatabaseClient();
try {
  await sql.unsafe(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  let deferredManualMigration: string | null = null;
  for (const file of files) {
    const applied = await sql`select 1 from schema_migrations where id = ${file}`;
    if (applied.length > 0) continue;
    const source = await readFile(resolve(migrationsDirectory, file), "utf8");
    if (source.startsWith(manualMigrationMarker) && !includeManualMigrations) {
      deferredManualMigration = file;
      break;
    }
    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
      await transaction`insert into schema_migrations (id) values (${file})`;
    });
    console.log(`Applied ${file}`);
  }
  if (deferredManualMigration) {
    console.log(`Deferred manual migration ${deferredManualMigration}; later migrations were not applied.`);
  } else {
    console.log("Database migrations are current.");
  }
} finally {
  await sql.end();
}
