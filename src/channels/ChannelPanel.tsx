import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";
import { useAuth } from "../auth/AuthContext";
import { scheduleData } from "../data/schedule";
import { formatDisplayTime } from "../lib/time";
import { WATCH_MARKS_CHANGED_EVENT } from "../watch-marks/useWatchMarks";
import {
  callInvitationFunction,
  clearInviteToken,
  invitationUrl,
  readInviteToken,
  type Channel,
  type ChannelInvitation,
  type InvitePreview,
} from "./channel-api";

type Member = { user_id: string; role: "owner" | "member"; auto_share_new_marks: boolean; profiles: { username: string } | null };
type SharedMark = { mark_id: string; window_start: string; showing_id: string; user_id: string; username: string; shared_at: string };
type GuestView = {
  channel: { id: string; name: string };
  members: { username: string; role: string }[];
  guests: { name: string }[];
  sharedMarks: { windowStart: string; showingId: string; username: string }[];
};

function avatarColor(username: string): string {
  const palette = ["#c75b4b", "#4d83b8", "#6d9852", "#9b62a5", "#c18a3f", "#4f9a92"];
  let hash = 0;
  for (const character of username) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function ChannelPanel() {
  const client = supabase;
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const creatingRef = useRef(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [invitations, setInvitations] = useState<ChannelInvitation[]>([]);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [sharedMarks, setSharedMarks] = useState<SharedMark[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [guestCredential, setGuestCredential] = useState<{ id: string; code: string } | null>(null);
  const [guestView, setGuestView] = useState<GuestView | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [friendIdCopied, setFriendIdCopied] = useState(false);

  const load = useCallback(async () => {
    if (!client || !user) {
      setChannels([]);
      setInvitations([]);
      setFriendId(null);
      return;
    }
    const [channelResult, invitationResult, friendResult] = await Promise.all([
      client.from("channels").select("id,name,owner_user_id").order("created_at"),
      client.rpc("list_my_channel_invitations"),
      client.rpc("get_my_friend_id"),
    ]);
    if (channelResult.error || invitationResult.error || friendResult.error) {
      setMessage("无法读取 Channel，请稍后重试。");
      return;
    }
    const nextChannels = channelResult.data as Channel[];
    setChannels(nextChannels);
    setInvitations(invitationResult.data as ChannelInvitation[]);
    setFriendId(friendResult.data as string);
    setSelected((current) => current && nextChannels.some((channel) => channel.id === current)
      ? current
      : nextChannels[0]?.id ?? null);
  }, [client, user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!client || !selected) {
      setMembers([]);
      return;
    }
    void client
      .from("channel_members")
      .select("user_id,role,auto_share_new_marks")
      .eq("channel_id", selected)
      .order("joined_at")
      .then(async ({ data, error }) => {
        if (error) setMessage("无法读取成员列表。");
        else {
          const rows = (data ?? []) as Omit<Member, "profiles">[];
          const { data: profiles } = await client
            .from("profiles")
            .select("id,username")
            .in("id", rows.map((row) => row.user_id));
          const usernames = new Map((profiles ?? []).map((profile) => [profile.id, profile.username]));
          setMembers(rows.map((row) => ({
            ...row,
            profiles: usernames.has(row.user_id) ? { username: usernames.get(row.user_id)! } : null,
          })));
        }
      });
  }, [client, selected]);

  const loadSharedMarks = useCallback(() => {
    if (!client || !selected) {
      setSharedMarks([]);
      return;
    }
    void client.rpc("list_channel_shared_marks", { target_channel_id: selected })
      .then(({ data, error }) => {
        if (error) setMessage("无法读取 Channel 想看活动。");
        else setSharedMarks((data ?? []) as SharedMark[]);
      });
  }, [client, selected]);

  useEffect(() => {
    loadSharedMarks();
    window.addEventListener(WATCH_MARKS_CHANGED_EVENT, loadSharedMarks);
    return () => window.removeEventListener(WATCH_MARKS_CHANGED_EVENT, loadSharedMarks);
  }, [loadSharedMarks]);

  useEffect(() => {
    const token = readInviteToken();
    if (!client || !token) return;
    void callInvitationFunction<{ invite: InvitePreview }>(client, { action: "preview", inviteToken: token })
      .then(({ invite }) => {
        setInvitePreview(invite);
        dialogRef.current?.showModal();
      })
      .catch(() => {
        setMessage("邀请链接无效或已过期。");
        clearInviteToken();
      });
  }, [client, user]);

  if (!client) return null;
  const selectedChannel = channels.find((channel) => channel.id === selected) ?? null;
  const owner = selectedChannel?.owner_user_id === user?.id;
  const myMembership = members.find((member) => member.user_id === user?.id);
  const sharedActivities = [...new Set(sharedMarks.map((mark) => mark.showing_id))].map((showingId) => {
    const showing = scheduleData.showings.find((row) => row.id === showingId);
    const film = showing ? scheduleData.films.find((row) => row.id === showing.filmId) : null;
    return {
      showingId,
      showing,
      film,
      usernames: sharedMarks.filter((mark) => mark.showing_id === showingId).map((mark) => mark.username),
    };
  });

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return requestAccountDialog();
    if (creatingRef.current) return;
    const formElement = event.currentTarget;
    const name = String(new FormData(formElement).get("name") ?? "").trim();
    if (!name) return;
    if (channels.some((channel) => channel.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setMessage("你已经有一个同名 Channel。");
      return;
    }
    creatingRef.current = true;
    setBusy(true);
    const { data, error } = await client!.rpc("create_channel", { channel_name: name });
    creatingRef.current = false;
    setBusy(false);
    if (error) return setMessage(error.code === "23505" ? "你已经有一个同名 Channel。" : "无法创建 Channel，请稍后重试。");
    formElement.reset();
    await load();
    setSelected(data as string);
    setMessage(`已创建「${name}」。`);
  }

  async function copyFriendId() {
    if (!friendId) return;
    try {
      await navigator.clipboard.writeText(friendId);
      setFriendIdCopied(true);
      window.setTimeout(() => setFriendIdCopied(false), 1800);
    } catch {
      setMessage("无法复制 Friend ID，请检查浏览器的剪贴板权限。");
    }
  }

  async function setAutoShare(enabled: boolean) {
    if (!selected) return;
    const { error } = await client!.rpc("set_channel_auto_share", {
      target_channel_id: selected,
      enabled,
    });
    if (error) return setMessage("无法更新默认同步设置。");
    setMembers((current) => current.map((member) => member.user_id === user?.id
      ? { ...member, auto_share_new_marks: enabled }
      : member));
    setMessage(enabled ? "以后新标记会默认同步到这个 Channel。" : "以后新标记不会默认同步到这个 Channel。");
  }

  async function deleteSelectedChannel() {
    if (!selectedChannel || !owner || busy) return;
    if (!window.confirm(`确定删除「${selectedChannel.name}」吗？成员、邀请与 guest 访问都会立即失效。`)) return;
    setBusy(true);
    const { error } = await client!.rpc("delete_channel", { target_channel_id: selectedChannel.id });
    setBusy(false);
    if (error) return setMessage("无法删除 Channel，请稍后重试。");
    setMessage(`已删除「${selectedChannel.name}」。`);
    setSelected(null);
    await load();
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const kind = String(form.get("kind"));
    const value = String(form.get("identifier") ?? "").trim();
    setBusy(true);
    if (kind === "email") {
      try {
        const result = await callInvitationFunction<{ message: string }>(client!, {
          action: "email_invite", channelId: selected, email: value,
        });
        setMessage(result.message);
      } catch {
        setMessage("无法发送邮箱邀请。");
      }
    } else {
      const { error } = await client!.rpc("invite_channel_user_by_friend_id", {
        target_channel_id: selected,
        target_friend_id: value,
      });
      setMessage(error ? "没有找到这个 Friend ID，或对方已经是成员。" : "邀请已发送，等待对方接受后才会加入。");
    }
    setBusy(false);
    formElement.reset();
  }

  async function createLink() {
    if (!selected) return;
    setBusy(true);
    const { data, error } = await client!.rpc("create_channel_invite_link", { target_channel_id: selected });
    setBusy(false);
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return setMessage("无法生成邀请链接。");
    const url = invitationUrl(row.invite_token);
    await navigator.clipboard.writeText(url);
    setMessage("邀请链接已复制：7 天有效，最多 20 人加入。");
  }

  async function acceptDirect(invitationId: string) {
    setBusy(true);
    const { error } = await client!.rpc("accept_channel_invitation", { target_invitation_id: invitationId });
    setBusy(false);
    setMessage(error ? "邀请已失效。" : "已加入 Channel。");
    await load();
  }

  async function acceptLink() {
    const token = readInviteToken();
    if (!token) return;
    if (!user) {
      dialogRef.current?.close();
      requestAccountDialog();
      return;
    }
    setBusy(true);
    const { error } = await client!.rpc("accept_channel_invite_link", { invite_token: token });
    setBusy(false);
    if (error) return setMessage("邀请已失效或人数已满。");
    clearInviteToken();
    setInvitePreview(null);
    dialogRef.current?.close();
    setMessage("已加入 Channel。");
    await load();
  }

  async function joinAsGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readInviteToken();
    if (!token) return;
    const guestName = String(new FormData(event.currentTarget).get("guest_name") ?? "").trim();
    setBusy(true);
    try {
      const result = await callInvitationFunction<{ guest: { id: string; accessCode: string } }>(client!, {
        action: "guest_join", inviteToken: token, guestName,
      });
      setGuestCredential({ id: result.guest.id, code: result.guest.accessCode });
      clearInviteToken();
    } catch {
      setMessage("无法以访客身份加入；链接可能已过期或请求过于频繁。");
    }
    setBusy(false);
  }

  async function accessAsGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await callInvitationFunction<{ view: GuestView }>(client!, {
        action: "guest_access",
        guestId: String(form.get("guest_id") ?? "").trim(),
        accessCode: String(form.get("access_code") ?? "").trim(),
      });
      setGuestView(result.view);
      setMessage(null);
    } catch {
      setMessage("访客凭证无效、已撤销或尝试次数过多。");
    }
    setBusy(false);
  }

  return (
    <>
    <button
      aria-expanded={mobileOpen}
      className="channel-mobile-toggle"
      onClick={() => setMobileOpen(true)}
      type="button"
    >☰ 一起看</button>
    <button
      aria-label="关闭 Channel"
      className={`channel-backdrop${mobileOpen ? " open" : ""}`}
      onClick={() => setMobileOpen(false)}
      type="button"
    />
    <aside className={`channel-panel${mobileOpen ? " open" : ""}`}>
      <div className="channel-heading">
        <div><span className="eyebrow dark">PRIVATE CHANNELS</span><h2>和朋友一起看</h2></div>
        <button className="channel-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button>
        {!user && <div className="channel-heading-actions">
          <button onClick={() => { setInvitePreview(null); setGuestView(null); dialogRef.current?.showModal(); }} type="button">使用访客代码</button>
          <button onClick={requestAccountDialog} type="button">登录后创建</button>
        </div>}
      </div>
      {user && <>
        <div className="friend-id">
          <span>你的 Friend ID</span>
          <div className="friend-id-value">
            <code>{friendId ?? "读取中…"}</code>
            <button disabled={!friendId} onClick={() => void copyFriendId()} type="button">
              {friendIdCopied ? "已复制" : "复制"}
            </button>
          </div>
        </div>
        {invitations.map((invitation) => <div className="channel-notice" key={invitation.invitation_id}>
          <span>@{invitation.inviter_username} 邀请你加入「{invitation.channel_name}」</span>
          <button disabled={busy} onClick={() => void acceptDirect(invitation.invitation_id)} type="button">接受</button>
        </div>)}
        <form className="channel-create" onSubmit={createChannel}>
          <input maxLength={80} name="name" placeholder="新 Channel 名称" required />
          <button disabled={busy} type="submit">{busy ? "处理中…" : "创建"}</button>
        </form>
        {channels.length > 0 && <div className="channel-workspace">
          <nav>{channels.map((channel) => <button className={selected === channel.id ? "active" : ""} key={channel.id} onClick={() => setSelected(channel.id)} type="button">{channel.name}</button>)}</nav>
          {selectedChannel && <div className="channel-detail">
            <h3>{selectedChannel.name}</h3>
            <p>{members.map((member) => `@${member.profiles?.username ?? "member"}${member.role === "owner" ? "（owner）" : ""}`).join(" · ")}</p>
            <label className="auto-share-setting">
              <input checked={myMembership?.auto_share_new_marks ?? false} onChange={(event) => void setAutoShare(event.target.checked)} type="checkbox" />
              新标记默认同步到这里
            </label>
            <div className="channel-activity">
              <b>大家想看</b>
              {sharedActivities.length === 0 ? <p>还没有成员分享想看场次。</p> : sharedActivities.map((activity) => <article key={activity.showingId}>
                <div><strong>{activity.film?.displayTitle ?? "已下架场次"}</strong>{activity.showing && <small>{activity.showing.localDate} · {formatDisplayTime(activity.showing.localTime)}</small>}</div>
                <div className="mark-avatars" aria-label={activity.usernames.map((name) => `@${name}`).join("、")}>
                  {activity.usernames.map((name) => <span key={name} style={{ background: avatarColor(name) }} title={`@${name}`}>{name[0]?.toUpperCase()}</span>)}
                </div>
              </article>)}
            </div>
            {owner && <>
              <form className="channel-invite" onSubmit={inviteUser}>
                <select name="kind"><option value="friend_id">Friend ID</option><option value="email">邮箱</option></select>
                <input name="identifier" placeholder="输入准确账号标识" required />
                <button disabled={busy} type="submit">邀请</button>
              </form>
              <button className="copy-invite" disabled={busy} onClick={() => void createLink()} type="button">复制分享链接</button>
              <button className="delete-channel" disabled={busy} onClick={() => void deleteSelectedChannel()} type="button">删除 Channel</button>
            </>}
          </div>}
        </div>}
      </>}
      {message && <p className="channel-message" role="status">{message}</p>}

      <dialog className="auth-dialog invite-dialog" ref={dialogRef}>
        <form className="dialog-close" method="dialog"><button aria-label="关闭" type="submit">×</button></form>
        <h2>{invitePreview ? `加入「${invitePreview.channelName}」` : guestView ? guestView.channel.name : "访客访问"}</h2>
        {guestView ? <div className="guest-view">
          <p>只读访客可以看到成员与已分享内容，但不能标记、编辑或进入其他 Channel。</p>
          <b>成员</b>
          <p>{guestView.members.map((member) => `@${member.username}${member.role === "owner" ? "（owner）" : ""}`).join(" · ")}</p>
          {guestView.guests.length > 0 && <><b>访客</b><p>{guestView.guests.map((guest) => guest.name).join(" · ")}</p></>}
          <b>大家想看</b>
          {guestView.sharedMarks.length === 0 ? <p>还没有成员分享想看场次。</p> : [...new Set(guestView.sharedMarks.map((mark) => mark.showingId))].map((showingId) => {
            const showing = scheduleData.showings.find((row) => row.id === showingId);
            const film = showing ? scheduleData.films.find((row) => row.id === showing.filmId) : null;
            const names = guestView.sharedMarks.filter((mark) => mark.showingId === showingId).map((mark) => mark.username);
            return <article key={showingId}><strong>{film?.displayTitle ?? "已下架场次"}</strong><div className="mark-avatars">{names.map((name) => <span key={name} style={{ background: avatarColor(name) }} title={`@${name}`}>{name[0]?.toUpperCase()}</span>)}</div></article>;
          })}
        </div> : guestCredential ? <div className="guest-credential">
          <p>请立即保存这组访客凭证。访问代码只显示一次，并且只能进入这个 Channel。</p>
          <code>Guest ID: {guestCredential.id}</code>
          <code>Access code: {guestCredential.code}</code>
        </div> : invitePreview ? <>
          <button className="auth-submit" disabled={busy} onClick={() => void acceptLink()} type="button">{user ? "加入我的账号" : "登录 / 注册后加入"}</button>
          {!user && <form className="auth-form guest-form" onSubmit={joinAsGuest}>
            <label>不注册，使用临时名字<input maxLength={40} name="guest_name" required /></label>
            <button className="auth-submit" disabled={busy} type="submit">只读访问</button>
          </form>}
        </> : <form className="auth-form" onSubmit={accessAsGuest}>
          <label>Guest ID<input autoComplete="off" name="guest_id" required /></label>
          <label>Access code<input autoComplete="off" name="access_code" required /></label>
          <button className="auth-submit" disabled={busy} type="submit">只读进入</button>
        </form>}
      </dialog>
    </aside>
    </>
  );
}
