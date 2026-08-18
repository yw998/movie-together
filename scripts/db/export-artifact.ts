import { writeFile } from "node:fs/promises";
import { createDatabaseClient } from "../../src/db/client";

const [, , kind, outputPath, windowArg, allowEmptyArg] = process.argv;
const windowStart = windowArg === "--allow-empty" ? undefined : windowArg;
const allowEmpty = windowArg === "--allow-empty" || allowEmptyArg === "--allow-empty";
const allowedKinds = new Set([
  "candidate", "compiled_schedule", "review_bundle", "review_report", "approval", "manual_overrides",
]);
if (!kind || !allowedKinds.has(kind) || !outputPath) {
  console.error("Usage: npm run db:export-artifact -- review_bundle output.json [windowStart] [--allow-empty]");
  process.exit(2);
}
const sql = createDatabaseClient();
const dateText = (value: unknown) => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value).slice(0, 10);
try {
  const rows = windowStart
    ? await sql`
        select wa.content, sw.window_start, sw.window_end
        from workflow_artifacts wa
        join schedule_weeks sw on sw.run_id = wa.run_id
        join published_weeks pw on pw.window_start = sw.window_start
        where pw.window_start = ${windowStart} and wa.kind = ${kind}
      `
    : await sql`
        select wa.content, sw.window_start, sw.window_end
        from workflow_artifacts wa
        join schedule_weeks sw on sw.run_id = wa.run_id
        join published_weeks pw on pw.window_start = sw.window_start
        where pw.is_current = true and wa.kind = ${kind}
      `;
  if (rows.length === 0 && allowEmpty && kind === "review_bundle") {
    await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date(0).toISOString(), adapters: [] }, null, 2)}\n`, { flag: "wx" });
    console.log(`No prior publication for ${windowStart}; wrote an empty review baseline.`);
  } else {
    if (rows.length !== 1) throw new Error(`Expected one ${kind} artifact, found ${rows.length}.`);
    const content = kind === "review_bundle"
      ? {
          ...rows[0].content,
          windowStart: dateText(rows[0].window_start),
          windowEnd: dateText(rows[0].window_end),
        }
      : rows[0].content;
    await writeFile(outputPath, `${JSON.stringify(content, null, 2)}\n`, { flag: "wx" });
    console.log(`Exported ${kind} artifact${windowStart ? ` for ${windowStart}` : ""} to ${outputPath}.`);
  }
} finally {
  await sql.end();
}
