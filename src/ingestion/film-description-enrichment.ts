import legacySchedule from "../data/legacy-schedule.json";
import type { Film, Showing } from "../types/schedule";

type DescriptionEntry = {
  text: string;
  source?: string;
};

const supplementalDescriptions: Record<string, DescriptionEntry> = {
  buddy: {
    text: "一档九十年代风格的儿童节目在魅力主持人突然施暴后，坠入血腥失控的噩梦。",
  },
  cam: {
    text: "网络主播发现自己的虚拟身份被神秘替身夺走，随即踏上危险的控制权争夺。",
  },
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
  "goody-goody": {
    text: "一场被暴雪困住的居家分娩接连出现诡异并发症，产前焦虑逐渐化为恐怖。",
  },
  "henry-portrait-serial-killer": {
    text: "一个四处漂泊的前科犯展开连环杀戮，冷酷人物研究直视暴力与人性深渊。",
  },
  "la-collectionneuse": {
    text: "两名男子与年轻女子共住蔚蓝海岸别墅，欲望与自我辩护化作心理游戏。",
  },
  "millionaires-express": {
    text: "洪金宝集结群星，让豪华列车、落魄小镇与各路匪徒撞成动作喜剧。",
  },
  "never-after-dark": {
    text: "温和的灵媒受邀前往偏僻旅馆驱邪，却被一股敌意深重的超自然力量步步逼近。",
  },
  "sudden-fury": {
    text: "丈夫在车祸后抛下妻子等死，企图夺取遗产的算计迅速滑向残酷失控。",
  },
  superbuhei: {
    text: "戒酒中的超市酒吧侍者怀疑自己正被邪恶双胞胎跟踪，日常由此变得诡异。",
  },
  "the-peril-at-pincer-point": {
    text: "录音师登上雾锁孤岛采集声音，却卷入失踪案与幽灵船长的海上传说。",
  },
  "the-piano": {
    text: "失语钢琴家带着女儿来到殖民时期的新西兰，在包办婚姻、欲望与自由之间挣扎。",
  },
  "the-taking-of-pelham-123": {
    text: "四名劫匪劫持纽约地铁列车并索要赎金，市府与交通警察在限时威胁下展开营救。",
    source: "https://www.tcm.com/watchtcm/titles/92255",
  },
  "dementia-13-director-s-cut": {
    text: "路易丝企图骗取婆婆的遗产，却让家族秘事逐渐演变为一连串谋杀。",
    source: "https://www.rialtopictures.com/catalogue/dementia-13-directors-cut",
  },
  "the-rain-people": {
    text: "一名郊区主妇突然离家，独自驾车横越美国寻找生活的另一种可能。",
    source: "https://www.tcm.com/watchtcm/titles/87618",
  },
  "the-conversation": {
    text: "一名监听专家从受托录下的对话中察觉谋杀阴谋，也陷入日益加深的疑惧。",
    source: "https://www.tcm.com/watchtcm/titles/71469",
  },
  "the-godfather": {
    text: "纽约一个势力庞大的黑帮家族，在权力传承与暴力冲突中经历动荡。",
    source: "https://www.tcm.com/watchtcm/titles/443184",
  },
  "new-york-stories": {
    text: "三位导演以各自独立的篇章，描绘纽约人的爱情、家庭与城市生活。",
    source: "https://catalog.afi.com/Film/58206-NEW-YORK-STORIES",
  },
  "the-godfather-ii": {
    text: "影片交错讲述维托·柯里昂的崛起与儿子迈克尔掌权后的家族衰落。",
    source: "https://www.tcm.com/articles/afi-top-100/140792/the-godfather-part-ii-1974",
  },
  "apocalypse-now-roadshow": {
    text: "一名美军上尉奉命深入越战腹地执行秘密任务，航程逐渐化为疯狂之旅。",
    source: "https://www.tcm.com/watchtcm/titles/67522",
  },
  "one-from-the-heart-reprise": {
    text: "拉斯维加斯的一对恋人在周年纪念日争吵分手，各自踏上一夜浪漫奇遇。",
    source: "https://catalog.afi.com/Film/68242-ONE-FROM-THE-HEART",
  },
  "the-son-of-the-sheik": {
    text: "一名阿拉伯骑士在沙漠匪徒的威胁下，设法保护自己爱上的舞女。",
    source: "https://www.tcm.com/watchtcm/titles/326475",
  },
  "the-razor-s-edge-lebanese-hostage-of-their-city": {
    text: "围城中的贝鲁特见证艺术家与难民少年的友谊，并以前导短片凝视战火城市。",
  },
  "the-trek": {
    text: "穿越卡拉哈里沙漠的殖民拓荒之旅被古老民间传说缠上，化作阴魂不散的西部恐怖。",
  },
  "the-weed-eaters": {
    text: "四名朋友在偏僻度假屋发现一批奇异大麻，意外死亡随即引爆混乱与食人危机。",
  },
  "toute-une-nuit": {
    text: "阿克曼以布鲁塞尔一夜的相遇、拥抱与别离，拼成潮湿而孤独的城市交响。",
  },
  veins: {
    text: "年轻女子久别返家，却发现父亲已死三天、母亲异常冷漠，家庭秘密随之浮现。",
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
