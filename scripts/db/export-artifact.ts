import { writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";

const [, , kind, outputPath] = process.argv;
const allowedKinds = new Set([
  "candidate", "compiled_schedule", "review_bundle", "review_report", "approval", "manual_overrides",
]);
if (!kind || !allowedKinds.has(kind) || !outputPath) {
  console.error("Usage: npm run db:export-artifact -- review_bundle output.json");
  process.exit(2);
}
const sql = createDatabaseClient();
try {
  const rows = await sql`
    select wa.content
    from workflow_artifacts wa
    join schedule_weeks sw on sw.run_id = wa.run_id
    join published_weeks pw on pw.window_start = sw.window_start
    where pw.is_current = true and wa.kind = ${kind}
  `;
  if (rows.length !== 1) throw new Error(`Expected one current ${kind} artifact, found ${rows.length}.`);
  await writeFile(outputPath, `${JSON.stringify(rows[0].content, null, 2)}\n`, { flag: "wx" });
  console.log(`Exported current ${kind} artifact to ${outputPath}.`);
} finally {
  await sql.end();
}
