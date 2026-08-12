import { readFile, writeFile } from "node:fs/promises";
import { automaticallyApproveCleanReport } from "../src/ingestion/review-approval";
import type { ReviewReport } from "../src/ingestion/review-report";

const [, , reportPath, approvalPath] = process.argv;
if (!reportPath || !approvalPath) {
  console.error("Usage: npm run auto-approve:schedule -- report.json approval.json");
  process.exit(2);
}
try {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as ReviewReport;
  const approval = automaticallyApproveCleanReport(report);
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, { flag: "wx" });
  console.log(`Clean report automatically approved at ${approvalPath}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
