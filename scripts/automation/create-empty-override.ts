import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { rollingWindowFor } from "../../src/lib/rolling-window";

const [, , anchor, outputPath] = process.argv;
if (!anchor || !outputPath) {
  console.error("Usage: npm run automation:create-override -- YYYY-MM-DD output.json");
  process.exit(2);
}
const window = rollingWindowFor(anchor);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ windowStart: window.start, windowEnd: window.end, entries: [] }, null, 2)}\n`,
  { flag: "wx" },
);
console.log(`Created empty override file for ${window.start} through ${window.end}.`);
