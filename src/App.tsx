import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { scheduleData, scheduleValidation } from "./data/schedule";
import {
  formatDisplayTime,
  getTimeCluster,
  minutesSinceMidnight,
  type TimeCluster,
} from "./lib/time";
import type { Showing } from "./types/schedule";
import { formatWindowYears, formatWindowZh } from "./lib/date-display";
import { AccountControl } from "./auth/AccountControl";
import { useWatchMarks } from "./watch-marks/useWatchMarks";
import { ChannelPanel } from "./channels/ChannelPanel";
import { ChannelMainView } from "./channels/ChannelMainView";
import { ShareMarkPopover } from "./watch-marks/ShareMarkDialog";
import { NotificationsView } from "./notifications/NotificationsView";

const timeClusters: TimeCluster[] = ["上午", "下午", "晚间", "深夜"];

type ColorStyle = CSSProperties & { "--c": string };

export default function App() {
  const { metadata, cinemas, films, showings, dateLabels } = scheduleData;
  const [selectedDate, setSelectedDate] = useState(metadata.windowStart);
  const [selectedCinemas, setSelectedCinemas] = useState(() =>
    cinemas.map((cinema) => cinema.id),
  );
  const [query, setQuery] = useState("");
  const [scheduleView, setScheduleView] = useState<"all" | "personal">("all");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [sharePrompt, setSharePrompt] = useState<{
    markId: string;
    filmTitle: string;
    anchor: { left: number; top: number; maxHeight: number; placement: "above" | "below" };
  } | null>(null);
  const watchMarks = useWatchMarks(showings);
  const navigateTogether = useCallback((channelId: string | null) => {
    setActiveChannelId(channelId);
    setNotificationsOpen(false);
    setSharePrompt(null);
  }, []);
  const openNotifications = useCallback(() => {
    setActiveChannelId(null);
    setNotificationsOpen(true);
    setSharePrompt(null);
  }, []);

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
          (scheduleView === "personal" || showing.localDate === selectedDate) &&
          selectedCinemas.includes(showing.cinemaId) &&
          (scheduleView === "all" || watchMarks.isMarked(showing.id)) &&
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
    scheduleView,
    watchMarks,
  ]);

  const groups = (scheduleView === "personal"
    ? dates.map((date) => ({
        name: dateLabels[date],
        rows: visibleShowings.filter((showing) => showing.localDate === date),
      }))
    : timeClusters.map((name) => ({
        name,
        rows: visibleShowings.filter(
          (showing) => getTimeCluster(showing.localTime) === name,
        ),
      })))
    .filter((group) => group.rows.length > 0);

  function toggleCinema(cinemaId: string) {
    setSelectedCinemas((current) =>
      current.includes(cinemaId)
        ? current.filter((id) => id !== cinemaId)
        : [...current, cinemaId],
    );
  }

  return (
    <main className={`app-shell${activeChannelId ? "" : " personal-home"}`}>
      <ChannelPanel
        activeChannelId={activeChannelId}
        notificationsOpen={notificationsOpen}
        onNavigate={navigateTogether}
      />
      <div className="site-shell">
      {!activeChannelId && <AccountControl
        lightBackground={notificationsOpen}
        notificationRefreshKey={notificationRefreshKey}
        notificationsOpen={notificationsOpen}
        onOpenNotifications={openNotifications}
      />}
      {activeChannelId ? <ChannelMainView channelId={activeChannelId} /> : notificationsOpen ? <NotificationsView
        onNotificationsChanged={() => setNotificationRefreshKey((current) => current + 1)}
        onOpenChannel={(channelId) => navigateTogether(channelId)}
      /> : <>
      <header className="hero">
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
          <span>{scheduleView === "personal" ? "个人主视图" : dateLabels[selectedDate]}</span>
          <div className="summary-tools">
            {watchMarks.signedIn && <div className="view-switch">
              <button className={scheduleView === "all" ? "active" : ""} onClick={() => setScheduleView("all")} type="button">全部排片</button>
              <button className={scheduleView === "personal" ? "active" : ""} onClick={() => setScheduleView("personal")} type="button">我的想看</button>
            </div>}
            <b>{visibleShowings.length} 场{watchMarks.signedIn && ` · 已标记 ${watchMarks.markedCount} 场`}</b>
          </div>
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
                    mutualCount={watchMarks.mutualCount(showing.id)}
                    onToggleMark={(button) => {
                      const anchor = sharePopoverAnchor(button);
                      void watchMarks.toggle(showing.id).then((result) => {
                      if (result?.action === "created") setSharePrompt({
                        markId: result.markId,
                        filmTitle: filmById.get(showing.filmId)!.displayTitle,
                        anchor,
                      });
                    });
                    }}
                    onEditShare={(button) => {
                      const markId = watchMarks.markId(showing.id);
                      if (markId) setSharePrompt({
                        markId,
                        filmTitle: filmById.get(showing.filmId)!.displayTitle,
                        anchor: sharePopoverAnchor(button),
                      });
                    }}
                    shareCount={watchMarks.shareCount(showing.id)}
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
      </>}
      </div>
      {sharePrompt && <ShareMarkPopover
        anchor={sharePrompt.anchor}
        filmTitle={sharePrompt.filmTitle}
        markId={sharePrompt.markId}
        onClose={() => setSharePrompt(null)}
        onSaved={(channelIds) => watchMarks.updateSharing(sharePrompt.markId, channelIds)}
      />}
    </main>
  );
}

type ShowingCardProps = {
  cinema: (typeof scheduleData.cinemas)[number];
  film: (typeof scheduleData.films)[number];
  showing: Showing;
  marked: boolean;
  markBusy: boolean;
  onToggleMark: (button: HTMLButtonElement) => void;
  onEditShare: (button: HTMLButtonElement) => void;
  signedIn: boolean;
  shareCount: number;
  mutualCount: number;
};

function ShowingCard({ cinema, film, showing, marked, markBusy, onToggleMark, onEditShare, signedIn, shareCount, mutualCount }: ShowingCardProps) {
  return (
    <article
      className="card"
      style={{ "--c": cinema.color } as ColorStyle}
    >
      <div className="time">{formatDisplayTime(showing.localTime)}</div>
      <div className="body">
        <div className="cinema">
          <i />
          {cinema.name}
        </div>
        <h2>{film.displayTitle}</h2>
        <p>
          {film.descriptionZh ??
            "本周特别放映；点击查看影院官方介绍与最新票务状态。"}
        </p>
        {showing.eventNote && <small>{showing.eventNote}</small>}
        {mutualCount > 0 && <small className="mutual-interest">共同 Channel 中有 {mutualCount} 人也想看</small>}
        {marked && <button className="share-count" onClick={(event) => onEditShare(event.currentTarget)} type="button">{shareCount > 0 ? `已分享至 ${shareCount} 个 Channel · 编辑` : "仅个人可见 · 设置分享"}</button>}
        <div className="card-actions">
          <a href={showing.detailUrl} rel="noreferrer" target="_blank">
            官方详情 / 购票 ↗
          </a>
          <button
            aria-pressed={marked}
            className={`watch-mark${marked ? " marked" : ""}`}
            disabled={markBusy}
            onClick={(event) => onToggleMark(event.currentTarget)}
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

function sharePopoverAnchor(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  const width = 286;
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  const roomBelow = window.innerHeight - rect.bottom - 12;
  const roomAbove = rect.top - 12;
  const placement = roomBelow >= Math.min(310, roomAbove) ? "below" as const : "above" as const;
  return {
    left,
    top: placement === "below" ? rect.bottom + 7 : rect.top - 7,
    maxHeight: Math.max(150, Math.min(390, placement === "below" ? roomBelow : roomAbove)),
    placement,
  };
}
