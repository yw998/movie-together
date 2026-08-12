import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { calendarWeekFor } from "../../src/lib/calendar-week";

const [, , anchor, outputPath] = process.argv;
if (!anchor || !outputPath) {
  console.error("Usage: npm run automation:create-override -- YYYY-MM-DD output.json");
  process.exit(2);
}
const week = calendarWeekFor(anchor);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ windowStart: week.start, windowEnd: week.end, entries: [] }, null, 2)}\n`,
  { flag: "wx" },
);
console.log(`Created empty override file for ${week.start} through ${week.end}.`);
