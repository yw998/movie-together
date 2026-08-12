import { calendarWeekFor } from "../../src/lib/calendar-week";

const [, , anchor] = process.argv;
if (!anchor) {
  console.error("Usage: npm run automation:week-info -- YYYY-MM-DD");
  process.exit(2);
}
const week = calendarWeekFor(anchor);
process.stdout.write(JSON.stringify({ anchor, windowStart: week.start, windowEnd: week.end }));
