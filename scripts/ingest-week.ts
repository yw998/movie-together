import { writeFile } from "node:fs/promises";
import { fetchWeeklyIngestionBundle } from "../src/ingestion/weekly-ingestion";

const [, , anchorLocalDate, outputPath] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorLocalDate ?? "") || !outputPath) {
  console.error("Usage: npm run ingest:week -- YYYY-MM-DD candidate.json");
  process.exit(2);
}
try {
  const bundle = await fetchWeeklyIngestionBundle(anchorLocalDate);
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx" });
  const failed = bundle.adapters.filter((adapter) => adapter.snapshot.result !== "success");
  console.log(
    `Candidate ${bundle.windowStart} through ${bundle.windowEnd} written to ${outputPath}; ` +
    `${bundle.adapters.length - failed.length}/${bundle.adapters.length} feeds succeeded.`,
  );
  console.log("Run review:schedule next. This command never publishes.");
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
