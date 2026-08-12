import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";
import { useAuth } from "../auth/AuthContext";
import {
  callInvitationFunction,
  clearInviteToken,
  invitationUrl,
  readInviteToken,
  type Channel,
  type ChannelInvitation,
  type InvitePreview,
} from "./channel-api";

type Member = { user_id: string; role: "owner" | "member"; profiles: { username: string } | null };
type GuestView = {
  channel: { id: string; name: string };
  members: { username: string; role: string }[];
  guests: { name: string }[];
};

export function ChannelPanel() {
  const client = supabase;
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [invitations, setInvitations] = useState<ChannelInvitation[]>([]);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [guestCredential, setGuestCredential] = useState<{ id: string; code: string } | null>(null);
  const [guestView, setGuestView] = useState<GuestView | null>(null);

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
      .select("user_id,role")
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

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return requestAccountDialog();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    const { data, error } = await client!.rpc("create_channel", { channel_name: name });
    setBusy(false);
    if (error) return setMessage("无法创建 Channel。");
    event.currentTarget.reset();
    await load();
    setSelected(data as string);
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
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
      const { error } = await client!.rpc("invite_channel_user", {
        target_channel_id: selected,
        identifier_kind: kind,
        identifier_value: value,
      });
      setMessage(error ? "没有找到可邀请的用户，或对方已经是成员。" : "邀请已发送。");
    }
    setBusy(false);
    event.currentTarget.reset();
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
    <section className="channel-panel">
      <div className="channel-heading">
        <div><span className="eyebrow dark">PRIVATE CHANNELS</span><h2>和朋友一起看</h2></div>
        {!user && <div className="channel-heading-actions">
          <button onClick={() => { setInvitePreview(null); setGuestView(null); dialogRef.current?.showModal(); }} type="button">使用访客代码</button>
          <button onClick={requestAccountDialog} type="button">登录后创建</button>
        </div>}
      </div>
      {user && <>
        <div className="friend-id">你的 Friend ID <code>{friendId ?? "读取中…"}</code></div>
        {invitations.map((invitation) => <div className="channel-notice" key={invitation.invitation_id}>
          <span>@{invitation.inviter_username} 邀请你加入「{invitation.channel_name}」</span>
          <button disabled={busy} onClick={() => void acceptDirect(invitation.invitation_id)} type="button">接受</button>
        </div>)}
        <form className="channel-create" onSubmit={createChannel}>
          <input maxLength={80} name="name" placeholder="新 Channel 名称" required />
          <button disabled={busy} type="submit">创建</button>
        </form>
        {channels.length > 0 && <div className="channel-workspace">
          <nav>{channels.map((channel) => <button className={selected === channel.id ? "active" : ""} key={channel.id} onClick={() => setSelected(channel.id)} type="button">{channel.name}</button>)}</nav>
          {selectedChannel && <div className="channel-detail">
            <h3>{selectedChannel.name}</h3>
            <p>{members.map((member) => `@${member.profiles?.username ?? "member"}${member.role === "owner" ? "（owner）" : ""}`).join(" · ")}</p>
            {owner && <>
              <form className="channel-invite" onSubmit={inviteUser}>
                <select name="kind"><option value="username">Username</option><option value="friend_id">Friend ID</option><option value="email">邮箱</option></select>
                <input name="identifier" placeholder="输入准确账号标识" required />
                <button disabled={busy} type="submit">邀请</button>
              </form>
              <button className="copy-invite" disabled={busy} onClick={() => void createLink()} type="button">复制分享链接</button>
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
    </section>
  );
}
