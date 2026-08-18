import { readFile, writeFile } from "node:fs/promises";
import { rollingWindowFor } from "../src/lib/rolling-window";
import { validateScheduleData } from "../src/lib/schedule-validation";
import type { Film, ScheduleData } from "../src/types/schedule";

const [, , outputPath, anchor, ...compiledPaths] = process.argv;
if (!outputPath || !/^\d{4}-\d{2}-\d{2}$/.test(anchor ?? "") || compiledPaths.length < 1) {
  console.error("Usage: npm run assemble:rolling-dry-run -- output.json YYYY-MM-DD week.json [next-week.json]");
  process.exit(2);
}

const window = rollingWindowFor(anchor!);
const compiled = await Promise.all(compiledPaths.map(async (path) => (
  JSON.parse(await readFile(path, "utf8")) as ScheduleData
)));
const catalog = JSON.stringify(compiled[0].cinemas);
if (compiled.some((schedule) => JSON.stringify(schedule.cinemas) !== catalog)) {
  throw new Error("Compiled candidates do not share the same cinema catalog.");
}

const showings = compiled
  .flatMap((schedule) => schedule.showings)
  .filter((showing) => showing.localDate >= window.start && showing.localDate <= window.end)
  .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id));
const showingIds = new Set<string>();
for (const showing of showings) {
  if (showingIds.has(showing.id)) throw new Error(`Duplicate rolling showing ID: ${showing.id}`);
  showingIds.add(showing.id);
}

const referencedFilmIds = new Set(showings.map((showing) => showing.filmId));
const filmsById = new Map<string, Film>();
for (const schedule of compiled) {
  for (const film of schedule.films) {
    if (referencedFilmIds.has(film.id)) filmsById.set(film.id, film);
  }
}
const refreshedLocalDate = compiled
  .map((schedule) => schedule.metadata.refreshedLocalDate)
  .sort()
  .at(-1)!;
const rolling: ScheduleData = {
  metadata: {
    timezone: "America/New_York",
    windowStart: window.start,
    windowEnd: window.end,
    refreshedLocalDate,
    provenanceNote: "Dry-run rolling export assembled from compiled, unapproved calendar-week candidates.",
  },
  cinemas: compiled[0].cinemas,
  films: [...filmsById.values()].sort((left, right) =>
    left.displayTitle.localeCompare(right.displayTitle) || left.id.localeCompare(right.id)),
  showings,
};
const validation = validateScheduleData(rolling, { staleAfterHours: Number.POSITIVE_INFINITY });
if (validation.errors > 0) {
  throw new Error(`Rolling dry run failed validation: ${validation.issues.map((issue) => issue.message).join(" ")}`);
}
await writeFile(outputPath, `${JSON.stringify(rolling, null, 2)}\n`, { flag: "wx" });
console.log(`Assembled dry-run rolling export with ${rolling.films.length} films and ${rolling.showings.length} showings.`);
