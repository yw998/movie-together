import { fetchRoxyCinemaSchedule } from "../src/ingestion/adapters/roxy-cinema";

const [, , windowStart, windowEnd] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(windowStart ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(windowEnd ?? "")) {
  console.error("Usage: npm run ingest:roxy-cinema -- YYYY-MM-DD YYYY-MM-DD");
  process.exit(2);
}
const result = await fetchRoxyCinemaSchedule(windowStart, windowEnd);
console.log(
  JSON.stringify(
    {
      cinemaId: result.cinemaId,
      status: result.snapshot.result,
      fetchedAt: result.snapshot.fetchedAt,
      sourceUrl: result.snapshot.sourceUrl,
      contentHash: result.snapshot.contentHash,
      parserVersion: result.snapshot.parserVersion,
      films: result.films.length,
      showings: result.showings.length,
      warnings: result.warnings,
      error: result.snapshot.error,
    },
    null,
    2,
  ),
);
if (result.snapshot.result === "failed") process.exitCode = 1;
