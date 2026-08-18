import { readFile, writeFile } from "node:fs/promises";
import { reconcileRollingCandidate } from "../src/ingestion/candidate-reconciliation";
import type { ReviewBundle } from "../src/ingestion/review-report";
import type { WeeklyIngestionBundle } from "../src/ingestion/weekly-ingestion";

const [, , currentPath, previousPath, outputPath] = process.argv;
if (!currentPath || !previousPath || !outputPath) {
  console.error("Usage: npm run reconcile:candidate -- raw-candidate.json previous-review-bundle.json candidate.json");
  process.exit(2);
}

try {
  const [current, previous] = await Promise.all([
    readFile(currentPath, "utf8").then((value) => JSON.parse(value) as WeeklyIngestionBundle),
    readFile(previousPath, "utf8").then((value) => JSON.parse(value) as ReviewBundle),
  ]);
  const reconciled = reconcileRollingCandidate(current, previous);
  await writeFile(outputPath, `${JSON.stringify(reconciled, null, 2)}\n`, { flag: "wx" });
  const fallbacks = reconciled.adapters.filter((adapter) => adapter.publicationFallback);
  console.log(
    fallbacks.length === 0
      ? "All cinema feeds are clean; no approved fallback was needed."
      : `Reconciled unavailable feeds for: ${fallbacks.map((adapter) => adapter.cinemaId).join(", ")}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
