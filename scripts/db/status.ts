import { createDatabaseClient } from "../../src/db/client";

const sql = createDatabaseClient();
try {
  const rows = await sql`
    select
      (select count(*)::int from cinemas) as cinemas,
      (select count(*)::int from films) as films,
      (select count(*)::int from films where description_zh is not null) as films_with_description_zh,
      (select count(*)::int from films where description_en is not null) as films_with_description_en,
      (select count(*)::int from showings) as showings,
      (select count(*)::int from source_snapshots) as source_snapshots,
      (select count(*)::int from manual_overrides) as manual_overrides,
      (select count(*)::int from review_reports) as review_reports,
      (select count(*)::int from approvals) as approvals,
      (select count(*)::int from workflow_artifacts) as workflow_artifacts,
      (select count(*)::int from published_weeks where is_current) as current_weeks,
      (select count(*)::int from schema_migrations) as applied_migrations,
      (select id from schema_migrations order by id desc limit 1) as latest_migration
  `;
  console.log(JSON.stringify(rows[0], null, 2));
} finally {
  await sql.end();
}
