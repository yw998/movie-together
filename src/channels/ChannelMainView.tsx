import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../auth/supabase";
import { scheduleData } from "../data/schedule";
import { formatDisplayTime, minutesSinceMidnight } from "../lib/time";
import { useWatchMarks, WATCH_MARKS_CHANGED_EVENT } from "../watch-marks/useWatchMarks";
import { avatarColor } from "./avatar";

type SharedMark = { showing_id: string; user_id: string; username: string };
type Member = { user_id: string; role: "owner" | "member"; username: string };

export function ChannelMainView({ channelId }: { channelId: string }) {
  const client = supabase;
  const { user } = useAuth();
  const watchMarks = useWatchMarks(scheduleData.metadata.windowStart);
  const [name, setName] = useState("Channel");
  const [members, setMembers] = useState<Member[]>([]);
  const [sharedMarks, setSharedMarks] = useState<SharedMark[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const [channelResult, memberResult, marksResult] = await Promise.all([
      client.from("channels").select("name").eq("id", channelId).single(),
      client.from("channel_members").select("user_id,role").eq("channel_id", channelId).order("joined_at"),
      client.rpc("list_channel_shared_marks", { target_channel_id: channelId }),
    ]);
    if (channelResult.error || memberResult.error || marksResult.error) {
      setError("无法读取这个 Channel，请稍后重试。");
      return;
    }
    const rows = memberResult.data ?? [];
    const profileResult = rows.length
      ? await client.from("profiles").select("id,username").in("id", rows.map((row) => row.user_id))
      : { data: [], error: null };
    if (profileResult.error) {
      setError("无法读取 Channel 成员。");
      return;
    }
    const usernames = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile.username]));
    setName(channelResult.data.name);
    setMembers(rows.map((row) => ({ ...row, username: usernames.get(row.user_id) ?? "member" })));
    setSharedMarks((marksResult.data ?? []) as SharedMark[]);
    setError(null);
  }, [channelId, client]);

  useEffect(() => {
    void load();
    window.addEventListener(WATCH_MARKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(WATCH_MARKS_CHANGED_EVENT, load);
  }, [load]);

  const activities = useMemo(() => [...new Set(sharedMarks.map((mark) => mark.showing_id))].map((showingId) => {
    const showing = scheduleData.showings.find((row) => row.id === showingId);
    const film = showing ? scheduleData.films.find((row) => row.id === showing.filmId) : null;
    const cinema = showing ? scheduleData.cinemas.find((row) => row.id === showing.cinemaId) : null;
    const marks = sharedMarks.filter((mark) => mark.showing_id === showingId);
    return { showingId, showing, film, cinema, marks };
  }).sort((left, right) => {
    if (!left.showing) return 1;
    if (!right.showing) return -1;
    return left.showing.localDate.localeCompare(right.showing.localDate)
      || minutesSinceMidnight(left.showing.localTime) - minutesSinceMidnight(right.showing.localTime);
  }), [sharedMarks]);

  const groups = useMemo(() => {
    const dated = Object.keys(scheduleData.dateLabels).map((date) => ({
      key: date,
      label: scheduleData.dateLabels[date],
      rows: activities.filter((activity) => activity.showing?.localDate === date),
    })).filter((group) => group.rows.length > 0);
    const removed = activities.filter((activity) => !activity.showing);
    return removed.length ? [...dated, { key: "removed", label: "已下架", rows: removed }] : dated;
  }, [activities]);

  return <section className="channel-main-view">
    <header className="channel-main-hero">
      <span className="eyebrow">TOGETHER CHANNEL</span>
      <h1>{name}</h1>
      <p>{members.length} 位成员 · {activities.length} 个共享场次</p>
      <div className="channel-main-members" aria-label={members.map((member) => `@${member.username}`).join("、")}>
        {members.map((member) => <span key={member.user_id} style={{ background: avatarColor(member.username) }} title={`@${member.username}${member.role === "owner" ? "（owner）" : ""}`}>{member.username[0]?.toUpperCase()}</span>)}
      </div>
    </header>
    <div className="channel-main-content">
      <div className="channel-main-title"><div><span className="eyebrow dark">SHARED WATCHLIST</span><h2>大家想看</h2></div><b>{activities.length} 场</b></div>
      {(error || watchMarks.error) && <aside className="mark-error" role="status">{error ?? watchMarks.error}</aside>}
      {groups.length === 0 ? <div className="channel-main-empty">还没有成员把想看场次分享到这里。</div> : groups.map((group) => <section className="channel-date-group" key={group.key}>
        <div className="channel-date-rail"><span>{group.label}</span><i /></div>
        <div className="channel-shared-grid">
          {group.rows.map((activity) => {
            const currentUserShared = activity.marks.some((mark) => mark.user_id === user?.id);
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
                  {activity.showing && <button
                    aria-pressed={currentUserShared}
                    className={`watch-mark${currentUserShared ? " marked" : ""}`}
                    disabled={currentUserShared || watchMarks.isBusy(activity.showingId)}
                    onClick={() => void watchMarks.addToChannel(activity.showingId, channelId)}
                    type="button"
                  >{watchMarks.isBusy(activity.showingId) ? "保存中…" : currentUserShared ? "✓ 已想看" : "+ 想看"}</button>}
                </div>
              </div>
            </article>;
          })}
        </div>
      </section>)}
    </div>
  </section>;
}
