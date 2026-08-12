import { writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";

const [, , kind, outputPath, windowStart, allowEmptyFlag] = process.argv;
const allowedKinds = new Set([
  "candidate", "compiled_schedule", "review_bundle", "review_report", "approval", "manual_overrides",
]);
if (!kind || !allowedKinds.has(kind) || !outputPath) {
  console.error("Usage: npm run db:export-artifact -- review_bundle output.json [windowStart] [--allow-empty]");
  process.exit(2);
}
const sql = createDatabaseClient();
try {
  const rows = windowStart
    ? await sql`
        select wa.content
        from workflow_artifacts wa
        join schedule_weeks sw on sw.run_id = wa.run_id
        join published_weeks pw on pw.window_start = sw.window_start
        where pw.window_start = ${windowStart} and wa.kind = ${kind}
      `
    : await sql`
        select wa.content
        from workflow_artifacts wa
        join schedule_weeks sw on sw.run_id = wa.run_id
        join published_weeks pw on pw.window_start = sw.window_start
        where pw.is_current = true and wa.kind = ${kind}
      `;
  if (rows.length === 0 && allowEmptyFlag === "--allow-empty" && kind === "review_bundle") {
    await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date(0).toISOString(), adapters: [] }, null, 2)}\n`, { flag: "wx" });
    console.log(`No prior publication for ${windowStart}; wrote an empty review baseline.`);
  } else {
    if (rows.length !== 1) throw new Error(`Expected one ${kind} artifact, found ${rows.length}.`);
    await writeFile(outputPath, `${JSON.stringify(rows[0].content, null, 2)}\n`, { flag: "wx" });
    console.log(`Exported ${kind} artifact${windowStart ? ` for ${windowStart}` : ""} to ${outputPath}.`);
  }
} finally {
  await sql.end();
}
