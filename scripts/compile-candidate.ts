import { readFile, writeFile } from "node:fs/promises";
import { compileWeeklyCandidate } from "../src/ingestion/candidate-compiler";
import { compiledScheduleReviewBundle } from "../src/ingestion/compiled-review";
import type { ManualOverrideFile } from "../src/ingestion/manual-overrides";
import type { WeeklyIngestionBundle } from "../src/ingestion/weekly-ingestion";

const [, , candidatePath, schedulePath, reviewBundlePath, overridePath] = process.argv;
if (!candidatePath || !schedulePath || !reviewBundlePath) {
  console.error("Usage: npm run compile:candidate -- candidate.json schedule.json review-bundle.json [overrides.json]");
  process.exit(2);
}
try {
  const source = JSON.parse(await readFile(candidatePath, "utf8")) as WeeklyIngestionBundle;
  const overrides = overridePath
    ? JSON.parse(await readFile(overridePath, "utf8")) as ManualOverrideFile
    : undefined;
  const compiled = compileWeeklyCandidate(source, overrides);
  const reviewBundle = compiledScheduleReviewBundle(source, compiled.schedule, compiled.resolvedWarnings);
  await Promise.all([
    writeFile(schedulePath, `${JSON.stringify(compiled.schedule, null, 2)}\n`, { flag: "wx" }),
    writeFile(reviewBundlePath, `${JSON.stringify(reviewBundle, null, 2)}\n`, { flag: "wx" }),
  ]);
  console.log(
    `Compiled ${compiled.schedule.showings.length} showings; applied ${compiled.appliedOverrides} override(s).`,
  );
  console.log("This command creates review artifacts and never publishes.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
