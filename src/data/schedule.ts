import publishedData from "./published-schedule.json";
import { validateScheduleData } from "../lib/schedule-validation";
import type { ScheduleData } from "../types/schedule";

export const scheduleData = {
  ...publishedData,
  films: publishedData.films.map((film) => ({
    ...film,
    descriptionEn: (film as { descriptionEn?: string | null }).descriptionEn ?? null,
  })),
} as ScheduleData;
export const scheduleValidation = validateScheduleData(scheduleData);

if (scheduleValidation.errors > 0) {
  throw new Error(
    `Schedule validation failed with ${scheduleValidation.errors} error(s).`,
  );
}
