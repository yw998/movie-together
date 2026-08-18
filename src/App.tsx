import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { scheduleData, scheduleValidation } from "./data/schedule";
import {
  defaultScheduleDate,
  formatDisplayTime,
  getTimeCluster,
  hasShowingStarted,
  minutesSinceMidnight,
  newYorkLocalDate,
  type TimeCluster,
} from "./lib/time";
import type { Showing } from "./types/schedule";
import { formatCalendarDate, formatWindow, formatWindowYears } from "./lib/date-display";
import { AccountControl } from "./auth/AccountControl";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./auth/supabase";
import { countMarkedShowings, showingMarkKey, useWatchMarks } from "./watch-marks/useWatchMarks";
import { ChannelPanel } from "./channels/ChannelPanel";
import { ChannelMainView } from "./channels/ChannelMainView";
import { ShareMarkPopover } from "./watch-marks/ShareMarkDialog";
import { NotificationsView } from "./notifications/NotificationsView";
import { useChannelIdentity } from "./channels/ChannelIdentityContext";
import { datesForWindow, rollingWindowFor } from "./lib/rolling-window";
import { ProductGuide } from "./product/ProductGuide";
import { requestAccountDialog, requestChannelCreateDialog, requestGroupPanel } from "./auth/account-events";
import { useI18n } from "./i18n/I18nContext";
import { LanguageSwitch } from "./i18n/LanguageSwitch";

const timeClusters: TimeCluster[] = ["morning", "afternoon", "evening", "lateNight"];
const LAST_PERSONAL_GROUP_KEY = "movie-together:last-personal-group";

type ColorStyle = CSSProperties & { "--c": string };

export default function App() {
  const { metadata, cinemas, films, showings } = scheduleData;
  const { locale, t } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const viewWindow = rollingWindowFor(newYorkLocalDate(nowMs));
  const dates = datesForWindow(viewWindow.start, viewWindow.end);
  const dateLabels = Object.fromEntries(dates.map((date) => [date, formatCalendarDate(date, locale)]));
  const [selectedDate, setSelectedDate] = useState(() =>
    defaultScheduleDate(dates, viewWindow.start),
  );
  const [selectedCinemas, setSelectedCinemas] = useState(() =>
    cinemas.map((cinema) => cinema.id),
  );
  const [query, setQuery] = useState("");
  const [scheduleView, setScheduleView] = useState<"all" | "personal">("all");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const channelIdentity = useChannelIdentity();
  const { user } = useAuth();
  const previousIdentityChannelRef = useRef<string | null>(null);
  const previousNotificationChannelRef = useRef<string | null>(null);
  const previousUserRef = useRef<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState<Set<string>>(new Set());
  const [sharePrompt, setSharePrompt] = useState<{
    markId: string;
    filmTitle: string;
    anchor: { left: number; top: number; maxHeight: number; placement: "above" | "below" };
  } | null>(null);
  const viewShowings = useMemo(
    () => showings.filter((showing) =>
      showing.localDate >= viewWindow.start && showing.localDate <= viewWindow.end),
    [showings, viewWindow.end, viewWindow.start],
  );
  const watchMarks = useWatchMarks(viewShowings);
  const identityMarkedCount = useMemo(() => countMarkedShowings(
    channelIdentity.marks
      .filter((mark) => mark.id === `identity:${channelIdentity.identity?.id}`)
      .map((mark) => showingMarkKey(mark.windowStart, mark.showingId)),
    viewShowings,
  ), [channelIdentity.identity?.id, channelIdentity.marks, viewShowings]);

  useEffect(() => {
    const refreshNow = () => setNowMs(Date.now());
    const timer = window.setInterval(refreshNow, 30_000);
    document.addEventListener("visibilitychange", refreshNow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, []);

  useEffect(() => {
    if (selectedDate < viewWindow.start || selectedDate > viewWindow.end) {
      setSelectedDate(viewWindow.start);
    }
  }, [selectedDate, viewWindow.end, viewWindow.start]);

  useEffect(() => {
    const previousChannelId = previousIdentityChannelRef.current;
    if (channelIdentity.identity) setActiveChannelId(channelIdentity.identity.channelId);
    if (!channelIdentity.identity && previousChannelId) {
      setActiveChannelId((current) => current === previousChannelId ? null : current);
    }
    previousIdentityChannelRef.current = channelIdentity.identity?.channelId ?? null;
  }, [channelIdentity.identity, channelIdentity.loading, channelIdentity.sessionToken]);

  useEffect(() => {
    const previousUserId = previousUserRef.current;
    if (user && previousUserId !== user.id) {
      const lastGroup = localStorage.getItem(LAST_PERSONAL_GROUP_KEY);
      if (lastGroup) setActiveChannelId(lastGroup);
    }
    previousUserRef.current = user?.id ?? null;
  }, [user]);
  const navigateTogether = useCallback((channelId: string | null) => {
    setActiveChannelId(channelId);
    setNotificationsOpen(false);
    setSharePrompt(null);
    if (user && channelId) localStorage.setItem(LAST_PERSONAL_GROUP_KEY, channelId);
    if (!channelId) return;
    if (user && supabase) {
      void supabase.rpc("mark_my_channel_notifications_read", { target_channel_id: channelId })
        .then(() => setNotificationRefreshKey((current) => current + 1));
    } else if (channelIdentity.identity?.channelId === channelId) {
      void channelIdentity.markNotificationsRead()
        .then(() => setNotificationRefreshKey((current) => current + 1));
    }
  }, [channelIdentity.identity?.channelId, channelIdentity.markNotificationsRead, user]);
  const toggleNotifications = useCallback(() => {
    if (notificationsOpen) {
      setNotificationsOpen(false);
      setActiveChannelId(previousNotificationChannelRef.current);
      previousNotificationChannelRef.current = null;
      return;
    }
    previousNotificationChannelRef.current = activeChannelId;
    setActiveChannelId(null);
    setNotificationsOpen(true);
    setSharePrompt(null);
  }, [activeChannelId, notificationsOpen]);

  const openGroups = useCallback(() => {
    if (channelIdentity.identity) {
      navigateTogether(channelIdentity.identity.channelId);
      return;
    }
    requestGroupPanel();
  }, [channelIdentity.identity, navigateTogether]);

  const cinemaById = useMemo(
    () => new Map(cinemas.map((cinema) => [cinema.id, cinema])),
    [cinemas],
  );
  const unavailableCinemaNames = (metadata.unavailableCinemaDates ?? [])
    .filter((item) => item.localDate === selectedDate && selectedCinemas.includes(item.cinemaId))
    .map((item) => cinemaById.get(item.cinemaId)?.name ?? item.cinemaId);
  const filmById = useMemo(
    () => new Map(films.map((film) => [film.id, film])),
    [films],
  );
  const upcomingStats = useMemo(() => {
    const upcoming = viewShowings.filter((showing) => !hasShowingStarted(showing.startsAt, nowMs));
    return {
      films: new Set(upcoming.map((showing) => showing.filmId)).size,
      showings: upcoming.length,
    };
  }, [nowMs, viewShowings]);

  const visibleShowings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return viewShowings
      .filter((showing) => {
        const cinema = cinemaById.get(showing.cinemaId);
        const film = filmById.get(showing.filmId);
        const searchable = `${film?.displayTitle ?? ""}${cinema?.name ?? ""}`;
        return (
          !hasShowingStarted(showing.startsAt, nowMs) &&
          (scheduleView === "personal" || showing.localDate === selectedDate) &&
          selectedCinemas.includes(showing.cinemaId) &&
          (scheduleView === "all" || (channelIdentity.identity
            ? channelIdentity.marks.some((mark) => mark.id === `identity:${channelIdentity.identity!.id}` && mark.showingId === showing.id)
            : watchMarks.isMarked(showing.id))) &&
          searchable.toLocaleLowerCase(locale).includes(normalizedQuery)
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
    viewShowings,
    scheduleView,
    watchMarks,
    channelIdentity.identity,
    channelIdentity.marks,
    nowMs,
    locale,
  ]);

  const groups = (scheduleView === "personal"
    ? dates.map((date) => ({
        name: dateLabels[date],
        rows: visibleShowings.filter((showing) => showing.localDate === date),
      }))
    : timeClusters.map((name) => ({
        name: t(`time.${name}`),
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
        onPanelOpenChange={setGroupPanelOpen}
      />
      <div className="site-shell">
      <LanguageSwitch />
      <AccountControl
        lightBackground={notificationsOpen}
        notificationRefreshKey={notificationRefreshKey}
        notificationsOpen={notificationsOpen}
        onOpenGroup={navigateTogether}
        onOpenNotifications={toggleNotifications}
      />
      <nav aria-label={t("nav.primary")} className="primary-nav">
        <button className={!activeChannelId && !notificationsOpen ? "active" : ""} onClick={() => navigateTogether(null)} type="button"><span>▤</span>{t("nav.schedule")}</button>
        <button className={activeChannelId || groupPanelOpen ? "active" : ""} onClick={openGroups} type="button"><span>◎</span>{t("nav.filmFams")}</button>
        <button className={notificationsOpen ? "active" : ""} onClick={toggleNotifications} type="button"><span>♢</span>{t("nav.notifications")}</button>
        <button onClick={requestAccountDialog} type="button"><span>○</span>{t("nav.account")}</button>
      </nav>
      {activeChannelId ? <ChannelMainView channelId={activeChannelId} nowMs={nowMs} /> : notificationsOpen ? <NotificationsView
        onNotificationsChanged={() => setNotificationRefreshKey((current) => current + 1)}
        onOpenChannel={(channelId) => navigateTogether(channelId)}
      /> : <>
      <header className="hero">
        <div className="eyebrow">
          NEW YORK · {formatWindowYears(viewWindow.start, viewWindow.end)}
        </div>
        <h1>{t("hero.title")}</h1>
        <p className="hero-positioning">{t("hero.positioning")}</p>
        <p className="hero-window">
          {t("hero.cinemas", { count: cinemas.length, window: formatWindow(viewWindow.start, viewWindow.end, locale) })}
        </p>
        <div className="hero-actions">
          <button onClick={requestChannelCreateDialog} type="button">{t("hero.createFam")}</button>
          <button className="secondary" onClick={() => setGuideOpen(true)} type="button">{t("hero.guide")}</button>
        </div>
        <small className="hero-privacy">{t("hero.privacy")}</small>
        <div className="stats">
          {t("hero.stats", { showings: upcomingStats.showings, films: upcomingStats.films })}
        </div>
      </header>

      <div className="sticky">
        {scheduleView === "all" && <nav className="dates" aria-label={t("schedule.dates")}>
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
        </nav>}
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
              aria-label={t("schedule.searchLabel")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("schedule.searchPlaceholder")}
              type="search"
              value={query}
            />
          </label>
        </div>
      </div>

      <section className="content">
        {!scheduleValidation.publishable && (
          <aside className="data-warning" role="status">
            {t("schedule.unverified")}
          </aside>
        )}
        {metadata.windowEnd < viewWindow.end && (
          <aside className="data-warning" role="status">
            {t("schedule.coverage", { date: formatCalendarDate(metadata.windowEnd, locale) })}
          </aside>
        )}
        {scheduleView === "all" && unavailableCinemaNames.length > 0 && (
          <aside className="data-warning" role="status">
            {t("schedule.cinemaUnavailable", { cinemas: unavailableCinemaNames.join(", ") })}
          </aside>
        )}
        <div className="summary">
          <span>{scheduleView === "personal" ? t("schedule.personalHeading") : dateLabels[selectedDate]}</span>
          <div className="summary-tools">
            {(watchMarks.signedIn || channelIdentity.identity) && <div className="view-switch">
              <button className={scheduleView === "all" ? "active" : ""} onClick={() => setScheduleView("all")} type="button">{t("schedule.all")}</button>
              <button className={scheduleView === "personal" ? "active" : ""} onClick={() => setScheduleView("personal")} type="button">{t("schedule.mine")}</button>
            </div>}
            <b>{t("schedule.count", { count: visibleShowings.length })}{channelIdentity.identity
              ? ` · ${t("schedule.markedCount", { count: identityMarkedCount })}`
              : watchMarks.signedIn && ` · ${t("schedule.markedCount", { count: watchMarks.markedCount })}`}</b>
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
                    markBusy={channelIdentity.identity ? identityBusy.has(showing.id) : watchMarks.isBusy(showing.id)}
                    marked={channelIdentity.identity
                      ? channelIdentity.marks.some((mark) => mark.id === `identity:${channelIdentity.identity!.id}` && mark.showingId === showing.id)
                      : watchMarks.isMarked(showing.id)}
                    mutualCount={watchMarks.mutualCount(showing.id)}
                    onToggleMark={(button) => {
                      if (channelIdentity.identity) {
                        setIdentityBusy((current) => new Set(current).add(showing.id));
                        void channelIdentity.toggleMark(showing.id, showing.localDate).finally(() => setIdentityBusy((current) => {
                          const next = new Set(current);
                          next.delete(showing.id);
                          return next;
                        }));
                        return;
                      }
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
                      if (channelIdentity.identity) return;
                      const markId = watchMarks.markId(showing.id);
                      if (markId) setSharePrompt({
                        markId,
                        filmTitle: filmById.get(showing.filmId)!.displayTitle,
                        anchor: sharePopoverAnchor(button),
                      });
                    }}
                    shareCount={channelIdentity.identity ? 1 : watchMarks.shareCount(showing.id)}
                    signedIn={Boolean(channelIdentity.identity) || watchMarks.signedIn}
                    channelOnly={Boolean(channelIdentity.identity)}
                    showing={showing}
                    locale={locale}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="empty">
            {selectedDate > metadata.windowEnd
              ? t("schedule.notRefreshed")
              : t("schedule.noResults")}
          </div>
        )}
      </section>

      <footer>
        <p>
          {t("schedule.footer", { date: formatCalendarDate(metadata.refreshedLocalDate, locale) })}
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
      <ProductGuide open={guideOpen} onClose={() => setGuideOpen(false)} onCreateGroup={requestChannelCreateDialog} />
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
  channelOnly: boolean;
  locale: "zh-CN" | "en-US";
};

function ShowingCard({ cinema, film, showing, marked, markBusy, onToggleMark, onEditShare, signedIn, shareCount, mutualCount, channelOnly, locale }: ShowingCardProps) {
  const { t } = useI18n();
  const description = locale === "zh-CN" ? film.descriptionZh : film.descriptionEn;
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
        {description && <p>{description}</p>}
        {showing.eventType === "other" && <small className="event-label">{t("event.special")}</small>}
        {showing.eventNote && <small>{showing.eventNote}</small>}
        {mutualCount > 0 && <small className="mutual-interest">{t("showing.mutual", { count: mutualCount })}</small>}
        {marked && (channelOnly
          ? <small className="mutual-interest">{t("showing.synced")}</small>
          : <button className="share-count" onClick={(event) => onEditShare(event.currentTarget)} type="button">{shareCount > 0 ? t("showing.shared", { count: shareCount }) : t("showing.privateShare")}</button>)}
        <div className="card-actions">
          <a href={showing.detailUrl} rel="noreferrer" target="_blank">
            {t("showing.official")}
          </a>
          <button
            aria-pressed={marked}
            className={`watch-mark${marked ? " marked" : ""}`}
            disabled={markBusy}
            onClick={(event) => onToggleMark(event.currentTarget)}
            title={channelOnly ? t("showing.channelOnlyTitle") : signedIn ? t("showing.privateTitle") : t("showing.signInTitle")}
            type="button"
          >
            {markBusy ? t("showing.saving") : marked ? t("showing.wanted") : t("showing.want")}
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
