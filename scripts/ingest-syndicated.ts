import { fetchSyndicatedSchedule } from "../src/ingestion/adapters/syndicated";

const [, , windowStart, windowEnd] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(windowStart ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(windowEnd ?? "")) {
  console.error("Usage: npm run ingest:syndicated -- YYYY-MM-DD YYYY-MM-DD");
  process.exit(2);
}
const result = await fetchSyndicatedSchedule(windowStart, windowEnd);
const titleByFilmId = new Map(result.films.map((film) => [film.id, film.displayTitle]));
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
      soldOut: result.showings.filter((showing) => showing.availability === "sold_out").length,
      specialEvents: result.showings.filter((showing) => showing.eventType === "other").length,
      schedule: result.showings.map((showing) => ({
        id: showing.id,
        title: titleByFilmId.get(showing.filmId) ?? showing.filmId,
        localDate: showing.localDate,
        localTime: showing.localTime,
        eventType: showing.eventType,
        eventNote: showing.eventNote,
        availabilityEvidence: showing.availability,
        ticketUrl: showing.ticketUrl,
      })),
      warnings: result.warnings,
      error: result.snapshot.error,
    },
    null,
    2,
  ),
);
if (result.snapshot.result === "failed") process.exitCode = 1;
