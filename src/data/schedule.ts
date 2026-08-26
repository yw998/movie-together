import publishedData from "./published-schedule.json";
import { validateScheduleData } from "../lib/schedule-validation";
import type { PublishedScheduleData, ScheduleData } from "../types/schedule";

export const scheduleData = {
  ...publishedData,
  metadata: {
    ...publishedData.metadata,
    unavailableCinemaDates: (publishedData.metadata as { unavailableCinemaDates?: ScheduleData["metadata"]["unavailableCinemaDates"] }).unavailableCinemaDates ?? [],
  },
  films: publishedData.films.map((film) => ({
    ...film,
    descriptionEn: (film as { descriptionEn?: string | null }).descriptionEn ?? null,
  })),
} as PublishedScheduleData;
export const scheduleValidation = validateScheduleData(scheduleData, { requireStorageIdentity: true });

if (scheduleValidation.errors > 0) {
  throw new Error(
    `Schedule validation failed with ${scheduleValidation.errors} error(s).`,
  );
}
