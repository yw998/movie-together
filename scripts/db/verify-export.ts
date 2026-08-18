import { readFile } from "node:fs/promises";
import { validateScheduleData } from "../../src/lib/schedule-validation";
import type { ScheduleData, Showing } from "../../src/types/schedule";

const [, , approvedPath, exportedPath] = process.argv;
if (!approvedPath || !exportedPath) {
  console.error("Usage: tsx scripts/db/verify-export.ts approved.json exported.json");
  process.exit(2);
}
const [approved, exported] = await Promise.all(
  [approvedPath, exportedPath].map(async (path) => JSON.parse(await readFile(path, "utf8")) as ScheduleData),
);

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

const approvedValidation = validateScheduleData(approved, { staleAfterHours: Number.POSITIVE_INFINITY });
const exportedValidation = validateScheduleData(exported, { staleAfterHours: Number.POSITIVE_INFINITY });
if (approvedValidation.errors || exportedValidation.errors) {
  throw new Error("Approved or exported schedule failed normalized validation.");
}
const comparisons = [
  ["metadata", approved.metadata, exported.metadata],
  ["cinemas", byId(approved.cinemas), byId(exported.cinemas)],
  ["films", byId(approved.films), byId(exported.films)],
  [
    "showings",
    byId(approved.showings).map(normalizedShowing),
    byId(exported.showings).map(normalizedShowing),
  ],
] as const;
for (const [label, expected, actual] of comparisons) {
  if (stable(expected) !== stable(actual)) throw new Error(`Database round trip changed ${label}.`);
}
console.log(`Round trip verified: ${exported.films.length} films and ${exported.showings.length} showings are unchanged.`);
