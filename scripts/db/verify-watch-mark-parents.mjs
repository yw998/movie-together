import { readFile } from "node:fs/promises";
import postgres from "postgres";

const [, , schedulePath] = process.argv;
if (!schedulePath) {
  console.error("Usage: npm run db:verify-watch-marks -- published-schedule.json");
  process.exit(2);
}
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

const schedule = JSON.parse(await readFile(schedulePath, "utf8"));
const identities = schedule.showings.map((showing, index) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(showing.storageWindowStart ?? "")) {
    throw new Error(`Showing ${index} (${showing.id}) has no valid storageWindowStart.`);
  }
  return { windowStart: showing.storageWindowStart, showingId: showing.id };
});
const identityKeys = identities.map(({ windowStart, showingId }) => `${windowStart}:${showingId}`);
if (new Set(identityKeys).size !== identityKeys.length) {
  throw new Error("Published schedule contains duplicate interactive showing identities.");
}

const sql = postgres(connectionString, { max: 1, ssl: "require" });
try {
  const showingIds = identities.map((identity) => identity.showingId);
  const windowStarts = [...new Set(identities.map((identity) => identity.windowStart))];
  const rows = await sql`
    select window_start::text, id
    from public.showings
    where id = any(${showingIds}) and window_start = any(${windowStarts}::date[])
  `;
  const parentKeys = new Set(rows.map((row) => `${row.window_start}:${row.id}`));
  const missing = identities.filter(({ windowStart, showingId }) => !parentKeys.has(`${windowStart}:${showingId}`));
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} published showing(s) have no watch-mark parent row: ` +
      missing.slice(0, 10).map(({ windowStart, showingId }) => `${windowStart}/${showingId}`).join(", "),
    );
  }
  console.log(`Verified ${identities.length} published watch-mark parent identities.`);
} finally {
  await sql.end();
}
