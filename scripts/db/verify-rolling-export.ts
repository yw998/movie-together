import { readFile } from "node:fs/promises";
import { validateScheduleData } from "../../src/lib/schedule-validation";
import type { Film, ScheduleData, Showing } from "../../src/types/schedule";

const [, , exportedPath, anchor, ...compiledPaths] = process.argv;
if (!exportedPath || !/^\d{4}-\d{2}-\d{2}$/.test(anchor ?? "") || compiledPaths.length < 1) {
  console.error("Usage: npm run db:verify-rolling -- exported.json YYYY-MM-DD week.json [next-week.json]");
  process.exit(2);
}

function addDays(localDate: string, days: number): string {
  const value = new Date(`${localDate}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function normalizedShowing(showing: Showing) {
  return {
    ...showing,
    startsAt: new Date(showing.startsAt).getTime(),
    fetchedAt: showing.fetchedAt === null ? null : new Date(showing.fetchedAt).getTime(),
  };
}
function byId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

const exported = JSON.parse(await readFile(exportedPath, "utf8")) as ScheduleData;
const compiled = await Promise.all(compiledPaths.map(async (path) => (
  JSON.parse(await readFile(path, "utf8")) as ScheduleData
)));
const rollingEnd = addDays(anchor!, 6);
const expectedShowings = compiled.flatMap((schedule) => schedule.showings)
  .filter((showing) => showing.localDate >= anchor! && showing.localDate <= rollingEnd);
const showingIds = new Set(expectedShowings.map((showing) => showing.filmId));
const filmsById = new Map<string, Film>();
for (const schedule of compiled) {
  for (const film of schedule.films) if (showingIds.has(film.id)) filmsById.set(film.id, film);
}

const validation = validateScheduleData(exported, {
  staleAfterHours: Number.POSITIVE_INFINITY,
  requireStorageIdentity: true,
});
if (validation.errors > 0) throw new Error("Rolling database export failed schedule validation.");
if (exported.metadata.windowStart !== anchor || exported.metadata.windowEnd !== rollingEnd) {
  throw new Error(`Rolling export window is ${exported.metadata.windowStart} through ${exported.metadata.windowEnd}.`);
}
if (stable(byId(expectedShowings).map(normalizedShowing)) !== stable(byId(exported.showings).map(normalizedShowing))) {
  throw new Error("Rolling database export changed showing facts.");
}
if (stable(byId([...filmsById.values()])) !== stable(byId(exported.films))) {
  throw new Error("Rolling database export changed film facts.");
}
console.log(`Rolling round trip verified: ${exported.films.length} films and ${exported.showings.length} showings.`);
