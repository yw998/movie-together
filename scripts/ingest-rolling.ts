import { writeFile } from "node:fs/promises";
import { fetchRollingIngestionBundle } from "../src/ingestion/weekly-ingestion";

const [, , anchorLocalDate, outputPath, continueFlag] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorLocalDate ?? "") || !outputPath) {
  console.error("Usage: npm run ingest:rolling -- YYYY-MM-DD candidate.json [--continue-on-feed-failure]");
  process.exit(2);
}
try {
  const bundle = await fetchRollingIngestionBundle(anchorLocalDate!);
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx" });
  const failed = bundle.adapters.filter((adapter) => adapter.snapshot.result !== "success");
  console.log(
    `Rolling candidate ${bundle.windowStart} through ${bundle.windowEnd} written to ${outputPath}; ` +
    `${bundle.adapters.length - failed.length}/${bundle.adapters.length} feeds succeeded.`,
  );
  console.log("Run review:schedule next. This command never publishes.");
  if (failed.length > 0 && continueFlag !== "--continue-on-feed-failure") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
