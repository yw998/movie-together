import { readFile, writeFile } from "node:fs/promises";
import type { ManualOverrideFile } from "../src/ingestion/manual-overrides";
import { prepareApprovedSchedule } from "../src/ingestion/promotion";
import type { ReviewApproval } from "../src/ingestion/review-approval";
import type { WeeklyIngestionBundle } from "../src/ingestion/weekly-ingestion";

const [, , candidatePath, approvalPath, outputPath, overridePath] = process.argv;
if (!candidatePath || !approvalPath || !outputPath) {
  console.error("Usage: npm run promote:schedule -- candidate.json approval.json published-schedule.json [overrides.json]");
  process.exit(2);
}
try {
  const [source, approval, overrides] = await Promise.all([
    readFile(candidatePath, "utf8").then((value) => JSON.parse(value) as WeeklyIngestionBundle),
    readFile(approvalPath, "utf8").then((value) => JSON.parse(value) as ReviewApproval),
    overridePath
      ? readFile(overridePath, "utf8").then((value) => JSON.parse(value) as ManualOverrideFile)
      : Promise.resolve(undefined),
  ]);
  const schedule = await prepareApprovedSchedule(source, approval, overrides);
  await writeFile(outputPath, `${JSON.stringify(schedule, null, 2)}\n`);
  console.log(`Published schedule data written to ${outputPath}. Run tests and the production build before deployment.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
