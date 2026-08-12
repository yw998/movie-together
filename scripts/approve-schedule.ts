import { readFile, writeFile } from "node:fs/promises";
import { approveReviewReport } from "../src/ingestion/review-approval";
import type { ReviewReport } from "../src/ingestion/review-report";

const [, , reportPath, reviewer, approvalPath] = process.argv;
if (!reportPath || !reviewer || !approvalPath) {
  console.error("Usage: npm run approve:schedule -- report.json reviewer approval.json");
  process.exit(2);
}
try {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as ReviewReport;
  const approval = approveReviewReport(report, reviewer);
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, { flag: "wx" });
  console.log(`Approval recorded at ${approvalPath}. Publication remains a separate explicit step.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
