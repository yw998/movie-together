import { useMemo, useState, type CSSProperties } from "react";
import { scheduleData, scheduleValidation } from "./data/schedule";
import {
  formatDisplayTime,
  getTimeCluster,
  minutesSinceMidnight,
  type TimeCluster,
} from "./lib/time";
import type { Showing } from "./types/schedule";
import { formatWindowYears, formatWindowZh } from "./lib/date-display";
import { availabilityLabel } from "./lib/showing-labels";
import { AccountControl } from "./auth/AccountControl";
import { useWatchMarks } from "./watch-marks/useWatchMarks";

const timeClusters: TimeCluster[] = ["上午", "下午", "晚间", "深夜"];

type ColorStyle = CSSProperties & { "--c": string };

export default function App() {
  const { metadata, cinemas, films, showings, dateLabels } = scheduleData;
  const [selectedDate, setSelectedDate] = useState(metadata.windowStart);
  const [selectedCinemas, setSelectedCinemas] = useState(() =>
    cinemas.map((cinema) => cinema.id),
  );
  const [query, setQuery] = useState("");
  const watchMarks = useWatchMarks(metadata.windowStart);

  const cinemaById = useMemo(
    () => new Map(cinemas.map((cinema) => [cinema.id, cinema])),
    [cinemas],
  );
  const filmById = useMemo(
    () => new Map(films.map((film) => [film.id, film])),
    [films],
  );
  const dates = Object.keys(dateLabels);

  const visibleShowings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return showings
      .filter((showing) => {
        const cinema = cinemaById.get(showing.cinemaId);
        const film = filmById.get(showing.filmId);
        const searchable = `${film?.displayTitle ?? ""}${cinema?.name ?? ""}`;
        return (
          showing.localDate === selectedDate &&
          selectedCinemas.includes(showing.cinemaId) &&
          searchable.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
        );
      })
      .sort(
        (left, right) =>
          minutesSinceMidnight(left.localTime) -
          minutesSinceMidnight(right.localTime),
      );
  }, [
    cinemaById,
    filmById,
    query,
    selectedCinemas,
    selectedDate,
    showings,
  ]);

  const groups = timeClusters
    .map((name) => ({
      name,
      rows: visibleShowings.filter(
        (showing) => getTimeCluster(showing.localTime) === name,
      ),
    }))
    .filter((group) => group.rows.length > 0);

  function toggleCinema(cinemaId: string) {
    setSelectedCinemas((current) =>
      current.includes(cinemaId)
        ? current.filter((id) => id !== cinemaId)
        : [...current, cinemaId],
    );
  }

  return (
    <main>
      <header className="hero">
        <AccountControl />
        <div className="eyebrow">
          NEW YORK · {formatWindowYears(metadata.windowStart, metadata.windowEnd)}
        </div>
        <h1>这周看什么？</h1>
        <p>
          {cinemas.length} 家纽约艺术影院 · {formatWindowZh(metadata.windowStart, metadata.windowEnd)}
        </p>
        <div className="stats">
          <b>{showings.length}</b> 个场次 <span>·</span>{" "}
          <b>{films.length}</b> 部影片
        </div>
      </header>

      <div className="sticky">
        <nav className="dates" aria-label="日期">
          {dates.map((date) => (
            <button
              className={date === selectedDate ? "active" : ""}
              key={date}
              onClick={() => setSelectedDate(date)}
              type="button"
            >
              {dateLabels[date]}
            </button>
          ))}
        </nav>
        <div className="filters">
          <div className="cinemas">
            {cinemas.map((cinema) => (
              <button
                className={selectedCinemas.includes(cinema.id) ? "on" : ""}
                key={cinema.id}
                onClick={() => toggleCinema(cinema.id)}
                style={{ "--c": cinema.color } as ColorStyle}
                type="button"
              >
                <i />
                {cinema.name}
              </button>
            ))}
          </div>
          <label className="search">
            ⌕
            <input
              aria-label="搜索电影或影院"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索电影或影院"
              type="search"
              value={query}
            />
          </label>
        </div>
      </div>

      <section className="content">
        {!scheduleValidation.publishable && (
          <aside className="data-warning" role="status">
            此排片恢复自旧版原型，尚未完成官方来源复核，当前不可直接发布。购票前请以影院官网为准。
          </aside>
        )}
        <div className="summary">
          <span>{dateLabels[selectedDate]}</span>
          <b>{visibleShowings.length} 场{watchMarks.signedIn && ` · 已标记 ${watchMarks.markedCount} 场`}</b>
        </div>
        {watchMarks.error && <aside className="mark-error" role="status">{watchMarks.error}</aside>}
        {groups.length ? (
          groups.map((group) => (
            <section className="cluster" key={group.name}>
              <div className="rail">
                <span>{group.name}</span>
                <i />
              </div>
              <div className="cards">
                {group.rows.map((showing) => (
                  <ShowingCard
                    cinema={cinemaById.get(showing.cinemaId)!}
                    film={filmById.get(showing.filmId)!}
                    key={showing.id}
                    markBusy={watchMarks.isBusy(showing.id)}
                    marked={watchMarks.isMarked(showing.id)}
                    onToggleMark={() => void watchMarks.toggle(showing.id)}
                    signedIn={watchMarks.signedIn}
                    showing={showing}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="empty">没有符合筛选条件的场次。</div>
        )}
      </section>

      <footer>
        <p>
          排片整理于 {metadata.refreshedLocalDate}（纽约时间）。影院可能临时调整或售罄，购票前请以官方页面为准。
        </p>
        <div>
          {cinemas.map((cinema) => (
            <a
              href={cinema.officialUrl}
              key={cinema.id}
              rel="noreferrer"
              target="_blank"
            >
              {cinema.name} ↗
            </a>
          ))}
        </div>
      </footer>
    </main>
  );
}

type ShowingCardProps = {
  cinema: (typeof scheduleData.cinemas)[number];
  film: (typeof scheduleData.films)[number];
  showing: Showing;
  marked: boolean;
  markBusy: boolean;
  onToggleMark: () => void;
  signedIn: boolean;
};

function ShowingCard({ cinema, film, showing, marked, markBusy, onToggleMark, signedIn }: ShowingCardProps) {
  const availability = availabilityLabel(showing.availability);
  return (
    <article
      className={`card${showing.availability === "sold_out" ? " sold-out" : ""}`}
      style={{ "--c": cinema.color } as ColorStyle}
    >
      <div className="time">{formatDisplayTime(showing.localTime)}</div>
      <div className="body">
        <div className="cinema">
          <i />
          {cinema.name}
          {availability && <strong className="availability">{availability}</strong>}
        </div>
        <h2>{film.displayTitle}</h2>
        <p>
          {film.descriptionZh ??
            "本周特别放映；点击查看影院官方介绍与最新票务状态。"}
        </p>
        {showing.eventNote && <small>{showing.eventNote}</small>}
        <div className="card-actions">
          <a href={showing.detailUrl} rel="noreferrer" target="_blank">
            {showing.availability === "sold_out" ? "查看官方详情" : "官方详情 / 购票"} ↗
          </a>
          <button
            aria-pressed={marked}
            className={`watch-mark${marked ? " marked" : ""}`}
            disabled={markBusy}
            onClick={onToggleMark}
            title={signedIn ? "此标记目前仅自己可见" : "登录后标记具体场次"}
            type="button"
          >
            {markBusy ? "保存中…" : marked ? "✓ 想看" : "+ 想看"}
          </button>
        </div>
      </div>
    </article>
  );
}
