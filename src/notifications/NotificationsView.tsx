import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";
import { scheduleData } from "../data/schedule";
import { formatDisplayTime } from "../lib/time";
import type { ChannelNotification } from "../channels/channel-api";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useI18n } from "../i18n/I18nContext";
import { formatCalendarDate } from "../lib/date-display";

type NotificationsViewProps = {
  onNotificationsChanged: () => void;
};

export function NotificationsView({ onNotificationsChanged }: NotificationsViewProps) {
  const client = supabase;
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const [activities, setActivities] = useState<ChannelNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const showingById = useMemo(() => new Map(scheduleData.showings.map((showing) => [showing.id, showing])), []);
  const filmById = useMemo(() => new Map(scheduleData.films.map((film) => [film.id, film])), []);
  const cinemaById = useMemo(() => new Map(scheduleData.cinemas.map((cinema) => [cinema.id, cinema])), []);

  const load = useCallback(async () => {
    if (!client || !user) {
      setActivities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await client.rpc("list_my_channel_notifications");
    setLoading(false);
    if (error) return setMessage(t("notifications.loadError"));
    setActivities((data ?? []) as ChannelNotification[]);
  }, [client, setMessage, t, user]);

  useEffect(() => { void load(); }, [load]);

  async function markAllRead() {
    if (!client || busy) return;
    setBusy(true);
    const { error } = await client.rpc("mark_my_channel_notifications_read", { target_channel_id: null });
    setBusy(false);
    if (error) return setMessage(t("notifications.readError"));
    setActivities((current) => current.map((activity) => ({ ...activity, is_new: false })));
    setMessage(t("notifications.readSuccess"));
    onNotificationsChanged();
  }

  if (!user) return <section className="notifications-view notifications-signed-out">
    <span className="eyebrow dark">NOTIFICATIONS</span><h1>{t("nav.notifications")}</h1>
    <p>{t("notifications.signInCopy")}</p>
    <button onClick={requestAccountDialog} type="button">{t("notifications.chooseSignIn")}</button>
  </section>;

  const unreadCount = activities.filter((activity) => activity.is_new).length;
  return <section className="notifications-view">
    <header className="notifications-header"><div><span className="eyebrow dark">NOTIFICATIONS</span><h1>{t("nav.notifications")}</h1></div>{unreadCount > 0 && <button disabled={busy} onClick={() => void markAllRead()} type="button">{t("notifications.markAll")}</button>}</header>
    {message && <p className="notifications-message" role="status">{message}</p>}
    {loading ? <p className="notifications-empty">{t("notifications.loading")}</p> : activities.length === 0 ? <p className="notifications-empty">{t("notifications.empty")}</p> : <div className="notifications-list">{activities.map((activity) => {
      const showing = showingById.get(activity.showing_id);
      const film = showing ? filmById.get(showing.filmId) : null;
      const cinema = showing ? cinemaById.get(showing.cinemaId) : null;
      const actorCopy = activity.actor_count === 1 ? activity.actor_names[0] ?? t("notifications.oneMember") : t("notifications.members", { count: activity.actor_count });
      return <article className={`notification-row activity-row${activity.is_new ? " unread" : ""}`} key={`${activity.channel_id}:${activity.window_start}:${activity.showing_id}`}>
        <span className="notification-dot" aria-label={activity.is_new ? t("notifications.unread") : t("notifications.read")} />
        <div><p><b>{actorCopy}</b> {t("notifications.marked", { name: `「${activity.channel_name}」` })}</p><strong>{film?.displayTitle ?? t("notifications.missingFilm")}</strong><small>{showing ? `${formatCalendarDate(showing.localDate, locale)} · ${formatDisplayTime(showing.localTime)} · ${cinema?.name ?? ""}` : t("notifications.showingId", { id: activity.showing_id })} · {formatDateTime(activity.shared_at, locale)}</small></div>
      </article>;
    })}</div>}
  </section>;
}

function formatDateTime(value: string, locale: "zh-CN" | "en-US") {
  return new Intl.DateTimeFormat(locale, { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
