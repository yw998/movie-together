import { rollingWindowFor } from "../../src/lib/rolling-window";

const [, , anchor] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor ?? "")) {
  console.error("Usage: npm run automation:rolling-info -- YYYY-MM-DD");
  process.exit(2);
}

const rolling = rollingWindowFor(anchor!);
process.stdout.write(JSON.stringify({
  anchor,
  rollingStart: rolling.start,
  rollingEnd: rolling.end,
  weekAnchors: rolling.weekStarts,
  weekStarts: rolling.weekStarts,
}));
