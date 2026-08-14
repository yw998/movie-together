import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";
import { scheduleData } from "../data/schedule";
import { formatDisplayTime } from "../lib/time";
import type { ChannelInvitation, ChannelNotification } from "../channels/channel-api";
import { notifyChannelsChanged } from "../channels/channel-api";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useChannelIdentity } from "../channels/ChannelIdentityContext";

type NotificationsViewProps = {
  onOpenChannel: (channelId: string) => void;
  onNotificationsChanged: () => void;
};

export function NotificationsView({ onOpenChannel, onNotificationsChanged }: NotificationsViewProps) {
  const client = supabase;
  const { user } = useAuth();
  const channelIdentity = useChannelIdentity();
  const [invitations, setInvitations] = useState<ChannelInvitation[]>([]);
  const [activities, setActivities] = useState<ChannelNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shareExistingInvitations, setShareExistingInvitations] = useState<Set<string>>(new Set());
  const [message, setMessage] = useTransientMessage();

  const showingById = useMemo(() => new Map(scheduleData.showings.map((showing) => [showing.id, showing])), []);
  const filmById = useMemo(() => new Map(scheduleData.films.map((film) => [film.id, film])), []);
  const cinemaById = useMemo(() => new Map(scheduleData.cinemas.map((cinema) => [cinema.id, cinema])), []);

  const load = useCallback(async () => {
    if (!user && channelIdentity.identity) {
      setInvitations([]);
      await channelIdentity.refreshNotifications();
      setLoading(false);
      return;
    }
    if (!client || !user) {
      setInvitations([]);
      setActivities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [invitationResult, activityResult] = await Promise.all([
      client.rpc("list_my_channel_invitations"),
      client.rpc("list_my_channel_notifications"),
    ]);
    setLoading(false);
    if (invitationResult.error || activityResult.error) {
      setMessage("无法读取提醒，请稍后重试。");
      return;
    }
    setInvitations((invitationResult.data ?? []) as ChannelInvitation[]);
    setActivities((activityResult.data ?? []) as ChannelNotification[]);
  }, [channelIdentity.identity, channelIdentity.refreshNotifications, client, user]);

  useEffect(() => { void load(); }, [load]);

  async function acceptInvitation(invitation: ChannelInvitation) {
    if (!client || busy) return;
    setBusy(true);
    const { error } = await client.rpc("accept_channel_invitation", {
      target_invitation_id: invitation.invitation_id,
      share_existing_marks: shareExistingInvitations.has(invitation.invitation_id),
    });
    setBusy(false);
    if (error) return setMessage("邀请已失效或 Channel 人数已满。");
    setMessage(`已加入「${invitation.channel_name}」。`);
    await load();
    notifyChannelsChanged();
    onNotificationsChanged();
  }

  async function markAllRead() {
    if (busy) return;
    setBusy(true);
    if (!user && channelIdentity.identity) {
      const ok = await channelIdentity.markNotificationsRead();
      setBusy(false);
      if (!ok) return setMessage("暂时无法标记为已读。");
      setMessage("新想看提醒已标为已读。");
      onNotificationsChanged();
      return;
    }
    if (!client) {
      setBusy(false);
      return;
    }
    const { error } = await client.rpc("mark_my_channel_notifications_read", { target_channel_id: null });
    setBusy(false);
    if (error) return setMessage("暂时无法标记为已读。");
    setActivities((current) => current.map((activity) => ({ ...activity, is_new: false })));
    setMessage("新想看提醒已标为已读。");
    onNotificationsChanged();
  }

  const visibleActivities = user ? activities : channelIdentity.notifications;
  const unreadCount = visibleActivities.filter((activity) => activity.is_new).length;
  const reminders = useMemo(() => [
    ...invitations.map((invitation) => ({
      kind: "invitation" as const,
      invitation,
      sortAt: Date.parse(invitation.expires_at) - 7 * 24 * 60 * 60 * 1000,
    })),
    ...visibleActivities.map((activity) => ({
      kind: "activity" as const,
      activity,
      sortAt: Date.parse(activity.shared_at),
    })),
  ].sort((left, right) => right.sortAt - left.sortAt), [invitations, visibleActivities]);

  if (!user && !channelIdentity.identity) return <section className="notifications-view notifications-signed-out">
    <span className="eyebrow dark">REMINDERS</span>
    <h1>提醒</h1>
    <p>登录后查看 Channel 邀请和朋友新分享的想看场次。</p>
    <button onClick={requestAccountDialog} type="button">登录 / 注册</button>
  </section>;

  return <section className="notifications-view">
    <header className="notifications-header">
      <div><span className="eyebrow dark">REMINDERS</span><h1>提醒</h1></div>
      {unreadCount > 0 && <button disabled={busy} onClick={() => void markAllRead()} type="button">全部标为已读</button>}
    </header>
    {message && <p className="notifications-message" role="status">{message}</p>}
    {loading || channelIdentity.notificationsLoading ? <p className="notifications-empty">正在读取提醒…</p> : reminders.length === 0
      ? <p className="notifications-empty">目前没有提醒。</p>
      : <div className="notifications-list">{reminders.map((reminder) => {
        if (reminder.kind === "invitation") {
          const { invitation } = reminder;
          return <article className="notification-row invitation-row unread" key={invitation.invitation_id}>
            <span className="notification-dot" aria-label="待处理" />
            <div className="notification-copy"><p><b>@{invitation.inviter_username}</b> 邀请你加入</p><strong>「{invitation.channel_name}」</strong><small>有效期至 {formatDateTime(invitation.expires_at)}</small></div>
            <div className="invitation-actions">
              <label>
                <input
                  checked={shareExistingInvitations.has(invitation.invitation_id)}
                  onChange={(event) => setShareExistingInvitations((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(invitation.invitation_id);
                    else next.delete(invitation.invitation_id);
                    return next;
                  })}
                  type="checkbox"
                />
                同步现有个人标记
              </label>
              <small>也可以加入后手动分享</small>
              <button disabled={busy} onClick={() => void acceptInvitation(invitation)} type="button">接受邀请</button>
            </div>
          </article>;
        }
        const { activity } = reminder;
          const showing = showingById.get(activity.showing_id);
          const film = showing ? filmById.get(showing.filmId) : null;
          const cinema = showing ? cinemaById.get(showing.cinemaId) : null;
          const actorCopy = activity.actor_count === 1
            ? activity.actor_names[0] ?? "一位成员"
            : `${activity.actor_count} 位成员`;
          return <article className={`notification-row activity-row${activity.is_new ? " unread" : ""}`} key={`${activity.channel_id}:${activity.window_start}:${activity.showing_id}`}>
            <span className="notification-dot" aria-label={activity.is_new ? "未读" : "已读"} />
            <div>
              <p><b>{actorCopy}</b> 在 <button className="notification-channel-link" onClick={() => onOpenChannel(activity.channel_id)} type="button">「{activity.channel_name}」</button> 标记了想看</p>
              <strong>{film?.displayTitle ?? "已不在当前七日排片中的场次"}</strong>
              <small>{showing ? `${showing.localDate} · ${formatDisplayTime(showing.localTime)} · ${cinema?.name ?? ""}` : `场次 ID：${activity.showing_id}`} · {formatDateTime(activity.shared_at)}</small>
            </div>
          </article>;
        })}</div>}
  </section>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
