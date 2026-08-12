import legacySchedule from "../data/legacy-schedule.json";
import type { Film, Showing } from "../types/schedule";

type DescriptionEntry = {
  text: string;
  source?: string;
};

const supplementalDescriptions: Record<string, DescriptionEntry> = {
  "54-the-director-s-cut-q-a-this-is-cine-matographe": {
    text: "泽西城少年踏入 1979 年 Studio 54 的炫目与代价，映后主创问答。",
  },
  bouchra: {
    text: "旅居纽约的酷儿艺术家在创作危机与母女关系间，重新面对跨文化身份。",
  },
  collateral: {
    text: "洛杉矶出租车司机被职业杀手挟持，在一夜之间驶入致命任务。",
  },
  "dead-souls-q-a": {
    text: "1890 年亚利桑那小镇因一份死者名单陷入荒诞混乱，映后主创问答。",
  },
  "dread-beat-an-blood": {
    text: "跟随诗人 Linton Kwesi Johnson 从录音室走上 Brixton 街头的音乐纪录片。",
    source: "https://www.bbfc.co.uk/release/dread-beat-and-blood-q29sbgvjdglvbjpwwc0yotc4nze",
  },
  "freefall-a-reckoning-for-boeing-open-captioning": {
    text: "Rory Kennedy 延续对波音危机、吹哨者与企业责任的调查；本场配开放字幕。",
  },
  "la-collectionneuse": {
    text: "两名男子与年轻女子共住蔚蓝海岸别墅，欲望与自我辩护化作心理游戏。",
  },
  "millionaires-express": {
    text: "洪金宝集结群星，让豪华列车、落魄小镇与各路匪徒撞成动作喜剧。",
  },
  "the-razor-s-edge-lebanese-hostage-of-their-city": {
    text: "围城中的贝鲁特见证艺术家与难民少年的友谊，并以前导短片凝视战火城市。",
  },
  "toute-une-nuit": {
    text: "阿克曼以布鲁塞尔一夜的相遇、拥抱与别离，拼成潮湿而孤独的城市交响。",
  },
};

const legacyDescriptions = new Map(
  Object.entries(legacySchedule.descriptions).map(([title, text]) => [
    title.trim().toLocaleLowerCase(),
    text,
  ]),
);

/**
 * Adds cached editorial Chinese copy without changing any schedule facts.
 * Adapter copy wins; the curated legacy catalog is a fallback for repeat films.
 */
export function enrichFilmDescriptions(
  films: readonly Film[],
  showings: readonly Showing[],
): Film[] {
  const detailUrlByFilmId = new Map<string, string>();
  for (const showing of showings) {
    if (!detailUrlByFilmId.has(showing.filmId)) {
      detailUrlByFilmId.set(showing.filmId, showing.detailUrl);
    }
  }

  return films.map((film) => {
    const supplemental = supplementalDescriptions[film.id];
    const catalogText = legacyDescriptions.get(
      film.displayTitle.trim().toLocaleLowerCase(),
    );
    const descriptionZh = film.descriptionZh ?? supplemental?.text ?? catalogText ?? null;
    if (!descriptionZh) {
      return { ...film, descriptionZh: null, descriptionSource: null };
    }
    return {
      ...film,
      descriptionZh,
      descriptionSource:
        film.descriptionSource ??
        supplemental?.source ??
        detailUrlByFilmId.get(film.id) ??
        null,
    };
  });
}
