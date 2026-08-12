import { readFile } from "node:fs/promises";
import { createReviewReport, formatReviewReport, type ReviewBundle } from "../src/ingestion/review-report";
import { digestReviewBundle } from "../src/ingestion/review-digest";

const [, , previousPath, currentPath, jsonReportPath, markdownReportPath] = process.argv;
if (!previousPath || !currentPath) {
  console.error("Usage: npm run review:schedule -- previous.json current.json");
  process.exit(2);
}
try {
  const [previous, current] = await Promise.all([
    readFile(previousPath, "utf8").then((value) => JSON.parse(value) as ReviewBundle),
    readFile(currentPath, "utf8").then((value) => JSON.parse(value) as ReviewBundle),
  ]);
  const report = createReviewReport(previous, current, await digestReviewBundle(current));
  const markdown = formatReviewReport(report);
  if (markdownReportPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(markdownReportPath, markdown, { flag: "wx" });
    console.log(
      `${report.publishable ? "Ready for approval" : "Held for review"}: ` +
      `${report.summary.added} added, ${report.summary.removed} removed, ` +
      `${report.summary.changed} changed, ${report.summary.concerns} concern(s).`,
    );
  } else {
    process.stdout.write(markdown);
  }
  if (jsonReportPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  }
  if (!report.publishable) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
