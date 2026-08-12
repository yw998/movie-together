import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../auth/supabase";
import { scheduleData } from "../data/schedule";
import { formatDisplayTime } from "../lib/time";
import { WATCH_MARKS_CHANGED_EVENT } from "../watch-marks/useWatchMarks";
import { avatarColor } from "./avatar";

type SharedMark = { showing_id: string; username: string };
type Member = { user_id: string; role: "owner" | "member"; username: string };

export function ChannelMainView({ channelId }: { channelId: string }) {
  const client = supabase;
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
    return {
      showingId,
      showing,
      film,
      cinema,
      usernames: sharedMarks.filter((mark) => mark.showing_id === showingId).map((mark) => mark.username),
    };
  }), [sharedMarks]);

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
      {error && <aside className="mark-error" role="status">{error}</aside>}
      {activities.length === 0 ? <div className="channel-main-empty">还没有成员把想看场次分享到这里。</div> : <div className="channel-shared-grid">
        {activities.map((activity) => <article className="channel-shared-card" key={activity.showingId}>
          <div className="channel-shared-meta">
            <span>{activity.showing ? `${activity.showing.localDate} · ${formatDisplayTime(activity.showing.localTime)}` : "场次已不在本周排片中"}</span>
            {activity.cinema && <b>{activity.cinema.name}</b>}
          </div>
          <h2>{activity.film?.displayTitle ?? "已下架场次"}</h2>
          {activity.film?.descriptionZh && <p>{activity.film.descriptionZh}</p>}
          <div className="channel-shared-footer">
            <div className="mark-avatars" aria-label={activity.usernames.map((username) => `@${username}`).join("、")}>
              {activity.usernames.map((username) => <span key={username} style={{ background: avatarColor(username) }} title={`@${username}`}>{username[0]?.toUpperCase()}</span>)}
            </div>
            {activity.showing && <a href={activity.showing.detailUrl} rel="noreferrer" target="_blank">官方详情 / 购票 ↗</a>}
          </div>
        </article>)}
      </div>}
    </div>
  </section>;
}
