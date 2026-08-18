import type { Film, ScheduleData } from "../types/schedule";

export type StoredFilmDescription = Pick<
  Film,
  "id" | "descriptionZh" | "descriptionEn" | "descriptionSource"
>;

export type DescriptionSyncStats = {
  matchedFilms: number;
  changedFilms: number;
  addedChinese: number;
  addedEnglish: number;
};

export function synchronizePublishedDescriptions(
  schedule: ScheduleData,
  descriptions: readonly StoredFilmDescription[],
): { schedule: ScheduleData; stats: DescriptionSyncStats } {
  const byId = new Map(descriptions.map((description) => [description.id, description]));
  const stats: DescriptionSyncStats = {
    matchedFilms: 0,
    changedFilms: 0,
    addedChinese: 0,
    addedEnglish: 0,
  };

  const films = schedule.films.map((film) => {
    const stored = byId.get(film.id);
    if (!stored) return film;
    stats.matchedFilms += 1;

    const descriptionZh = stored.descriptionZh;
    const descriptionEn = stored.descriptionEn;
    const descriptionSource = descriptionZh || descriptionEn ? stored.descriptionSource : null;
    if ((descriptionZh || descriptionEn) && !descriptionSource) {
      throw new Error(`Stored descriptions for ${film.id} have no evidence source.`);
    }

    if (!film.descriptionZh && descriptionZh) stats.addedChinese += 1;
    if (!film.descriptionEn && descriptionEn) stats.addedEnglish += 1;
    if (
      descriptionZh !== film.descriptionZh ||
      descriptionEn !== film.descriptionEn ||
      descriptionSource !== film.descriptionSource
    ) {
      stats.changedFilms += 1;
    }

    return { ...film, descriptionZh, descriptionEn, descriptionSource };
  });

  return { schedule: { ...schedule, films }, stats };
}
