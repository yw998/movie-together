import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../auth/supabase";
import { scheduleData } from "../data/schedule";
import { formatDisplayTime, hasShowingStarted, minutesSinceMidnight } from "../lib/time";
import { useWatchMarks, WATCH_MARKS_CHANGED_EVENT } from "../watch-marks/useWatchMarks";
import { avatarColor } from "./avatar";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useChannelIdentity } from "./ChannelIdentityContext";

type SharedMark = { showing_id: string; user_id: string; username: string };
type Member = { user_id: string; role: "owner" | "member"; username: string; kind?: "account" | "channel_only" };
type ParticipantRow = { participant_id: string; display_name: string; role: string; kind: string };

export function ChannelMainView({ channelId, nowMs }: { channelId: string; nowMs: number }) {
  const client = supabase;
  const { user } = useAuth();
  const channelIdentity = useChannelIdentity();
  const watchMarks = useWatchMarks(scheduleData.showings);
  const [name, setName] = useState("观影小组");
  const [members, setMembers] = useState<Member[]>([]);
  const [sharedMarks, setSharedMarks] = useState<SharedMark[]>([]);
  const [error, setError] = useTransientMessage();
  const [removePrompt, setRemovePrompt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (channelIdentity.identity?.channelId === channelId) {
      setName(channelIdentity.identity.channelName);
      setMembers(channelIdentity.members.map((member) => ({
        user_id: member.id,
        role: member.role,
        username: member.displayName,
        kind: member.kind,
      })));
      setSharedMarks(channelIdentity.marks.map((mark) => ({
        showing_id: mark.showingId,
        user_id: mark.id,
        username: mark.displayName,
      })));
      setError(null);
      return;
    }
    if (!client) return;
    const [channelResult, memberResult, marksResult] = await Promise.all([
      client.from("channels").select("name").eq("id", channelId).single(),
      client.rpc("list_channel_participants", { target_channel_id: channelId }),
      client.rpc("list_channel_shared_marks", { target_channel_id: channelId }),
    ]);
    if (channelResult.error || memberResult.error || marksResult.error) {
      setError("无法读取这个观影小组，请稍后重试。");
      return;
    }
    setName(channelResult.data.name);
    setMembers(((memberResult.data ?? []) as ParticipantRow[]).map((row) => ({
      user_id: row.participant_id,
      role: row.role as "owner" | "member",
      username: row.display_name,
      kind: row.kind as "account" | "channel_only",
    })));
    setSharedMarks((marksResult.data ?? []) as SharedMark[]);
    setError(null);
  }, [channelId, channelIdentity.identity, channelIdentity.marks, channelIdentity.members, client]);

  useEffect(() => {
    void load();
    window.addEventListener(WATCH_MARKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(WATCH_MARKS_CHANGED_EVENT, load);
  }, [load]);

  const activities = useMemo(() => {
    const showingIds = [...new Set(sharedMarks.map((mark) => mark.showing_id))];
    return showingIds.map((showingId) => {
    const showing = scheduleData.showings.find((row) => row.id === showingId);
    const film = showing ? scheduleData.films.find((row) => row.id === showing.filmId) : null;
    const cinema = showing ? scheduleData.cinemas.find((row) => row.id === showing.cinemaId) : null;
    const marks = sharedMarks.filter((mark) => mark.showing_id === showingId);
    return { showingId, showing, film, cinema, marks };
  }).filter((activity) => activity.showing && !hasShowingStarted(activity.showing.startsAt, nowMs)).sort((left, right) => {
    if (!left.showing) return 1;
    if (!right.showing) return -1;
    return left.showing.localDate.localeCompare(right.showing.localDate)
      || minutesSinceMidnight(left.showing.localTime) - minutesSinceMidnight(right.showing.localTime);
    });
  }, [nowMs, sharedMarks]);

  const sharedShowingCount = activities.length;

  const groups = useMemo(() => {
    const dated = Object.keys(scheduleData.dateLabels).map((date) => ({
      key: date,
      label: scheduleData.dateLabels[date],
      rows: activities.filter((activity) => activity.showing?.localDate === date),
    })).filter((group) => group.rows.length > 0);
    return dated;
  }, [activities]);

  return <section className="channel-main-view">
    <header className="channel-main-hero">
      <span className="eyebrow">PRIVATE WATCH GROUP</span>
      <h1>{name}</h1>
      <p>{members.length} 位成员 · {sharedShowingCount} 个共享场次</p>
      <div className="channel-main-members" aria-label={members.map((member) => member.kind === "channel_only" ? `${member.username}（小组身份）` : `@${member.username}`).join("、")}>
        {members.map((member) => <span key={member.user_id} style={{ background: avatarColor(member.username) }} title={`${member.kind === "channel_only" ? member.username : `@${member.username}`}${member.kind === "channel_only" ? "（小组身份）" : ""}${member.role === "owner" ? "（创建者）" : ""}`}>{member.username[0]?.toUpperCase()}</span>)}
      </div>
    </header>
    <div className="channel-main-content">
      <div className="channel-main-title"><div><span className="eyebrow dark">SHARED WATCHLIST</span><h2>大家想看</h2></div><b>{activities.length} 场</b></div>
      {(error || watchMarks.error) && <aside className="mark-error" role="status">{error ?? watchMarks.error}</aside>}
      {groups.length === 0 ? <div className="channel-main-empty">还没有成员把想看场次分享到这里。</div> : groups.map((group) => <section className="channel-date-group" key={group.key}>
        <div className="channel-date-rail"><span>{group.label}</span><i /></div>
        <div className="channel-shared-grid">
          {group.rows.map((activity) => {
            const identityMarkOwner = channelIdentity.identity ? `identity:${channelIdentity.identity.id}` : null;
            const currentUserShared = activity.marks.some((mark) => mark.user_id === (identityMarkOwner ?? user?.id));
            return <article className="channel-shared-card" key={activity.showingId}>
              <div className="channel-shared-meta">
                <span>{activity.showing ? formatDisplayTime(activity.showing.localTime) : "场次已不在本周排片中"}</span>
                {activity.cinema && <b>{activity.cinema.name}</b>}
              </div>
              <h2>{activity.film?.displayTitle ?? "已下架场次"}</h2>
              {activity.film?.descriptionZh && <p>{activity.film.descriptionZh}</p>}
              <div className="channel-shared-footer">
                <div className="mark-avatars" aria-label={activity.marks.map((mark) => `@${mark.username}`).join("、")}>
                  {activity.marks.map((mark) => <span key={mark.user_id} style={{ background: avatarColor(mark.username) }} title={`@${mark.username}`}>{mark.username[0]?.toUpperCase()}</span>)}
                </div>
                <div className="channel-card-actions">
                  {activity.showing && <a href={activity.showing.detailUrl} rel="noreferrer" target="_blank">官方详情 / 购票 ↗</a>}
                  {activity.showing && <div className="channel-mark-control">
                    <button
                      aria-expanded={currentUserShared ? removePrompt === activity.showingId : undefined}
                      aria-pressed={currentUserShared}
                      className={`watch-mark${currentUserShared ? " marked" : ""}`}
                      disabled={watchMarks.isBusy(activity.showingId)}
                      onClick={() => channelIdentity.identity
                        ? void channelIdentity.toggleMark(activity.showingId, activity.showing!.localDate)
                        : currentUserShared
                          ? setRemovePrompt((current) => current === activity.showingId ? null : activity.showingId)
                          : void watchMarks.addToChannel(activity.showingId, channelId)}
                      type="button"
                    >{watchMarks.isBusy(activity.showingId) ? "保存中…" : currentUserShared ? "✓ 已想看" : "+ 想看"}</button>
                    {!channelIdentity.identity && currentUserShared && removePrompt === activity.showingId && <div className="channel-remove-menu" role="dialog" aria-label="取消想看">
                      <b>如何取消？</b>
                      <button onClick={() => { setRemovePrompt(null); void watchMarks.removeFromChannel(activity.showingId, channelId); }} type="button">仅从这个观影小组取消</button>
                      <button className="remove-personal-mark" onClick={() => { setRemovePrompt(null); void watchMarks.toggle(activity.showingId); }} type="button">从个人想看中删除<small>也会从所有观影小组移除</small></button>
                      <button className="cancel-remove-mark" onClick={() => setRemovePrompt(null)} type="button">保留想看</button>
                    </div>}
                  </div>}
                </div>
              </div>
            </article>;
          })}
        </div>
      </section>)}
    </div>
  </section>;
}
