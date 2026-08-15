import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OPEN_GROUP_PANEL_EVENT, OPEN_REGISTERED_GROUP_CREATE_EVENT, requestAccountDialog, requestChannelCreateDialog, requestIdentityCredentialsDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";
import { useAuth } from "../auth/AuthContext";
import {
  callInvitationFunction,
  CHANNELS_CHANGED_EVENT,
  clearInviteToken,
  invitationUrl,
  notifyChannelsChanged,
  readInviteToken,
  type Channel,
  type InvitePreview,
} from "./channel-api";
import { avatarColor } from "./avatar";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useChannelIdentity } from "./ChannelIdentityContext";
import { ChannelIdentityPanel } from "./ChannelIdentityPanel";

type Member = { user_id: string; role: "owner" | "member"; auto_share_new_marks: boolean; kind: "account" | "channel_only"; profiles: { username: string } | null };
type ParticipantRow = { participant_id: string; display_name: string; role: string; kind: string; auto_share_new_marks: boolean };
type InviteLinkRow = { id: string; expires_at: string; use_count: number; max_uses: number; revoked_at: string | null };

type ChannelPanelProps = {
  activeChannelId: string | null;
  notificationsOpen: boolean;
  onNavigate: (channelId: string | null) => void;
};

export function ChannelPanel(props: ChannelPanelProps) {
  const { identity } = useChannelIdentity();
  return identity ? <ChannelIdentityPanel {...props} /> : <RegisteredChannelPanel {...props} />;
}

function RegisteredChannelPanel({ activeChannelId, notificationsOpen, onNavigate }: ChannelPanelProps) {
  const client = supabase;
  const { user, username } = useAuth();
  const channelIdentity = useChannelIdentity();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const creatingRef = useRef(false);
  const friendIdCopyTimerRef = useRef<number | null>(null);
  const inviteCopyTimerRef = useRef<number | null>(null);
  const deleteNoticeTimerRef = useRef<number | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteLinks, setInviteLinks] = useState<InviteLinkRow[]>([]);
  const [message, setMessage] = useTransientMessage();
  const [busy, setBusy] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [shareExistingOnJoin, setShareExistingOnJoin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [friendIdCopied, setFriendIdCopied] = useState(false);
  const [createMessage, setCreateMessage] = useTransientMessage();
  const [inviteNotice, setInviteNotice] = useState<{ id: number; text: string } | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<{ id: number; text: string } | null>(null);
  const selected = activeChannelId;

  const load = useCallback(async () => {
    if (!client || !user) {
      setChannels([]);
      setFriendId(null);
      return;
    }
    const [channelResult, friendResult] = await Promise.all([
      client.from("channels").select("id,name,owner_user_id").order("created_at"),
      client.rpc("get_my_friend_id"),
    ]);
    if (channelResult.error || friendResult.error) {
      setMessage("无法读取观影小组，请稍后重试。");
      return;
    }
    const nextChannels = channelResult.data as Channel[];
    setChannels(nextChannels);
    setFriendId(friendResult.data as string);
    if (activeChannelId && !nextChannels.some((channel) => channel.id === activeChannelId)) onNavigate(null);
  }, [activeChannelId, client, onNavigate, user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    window.addEventListener(CHANNELS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CHANNELS_CHANGED_EVENT, load);
  }, [load]);

  useEffect(() => {
    const openPanel = () => setMobileOpen(true);
    const openCreate = () => { setCreateMessage(null); setMobileOpen(false); createDialogRef.current?.showModal(); };
    window.addEventListener(OPEN_GROUP_PANEL_EVENT, openPanel);
    window.addEventListener(OPEN_REGISTERED_GROUP_CREATE_EVENT, openCreate);
    return () => {
      window.removeEventListener(OPEN_GROUP_PANEL_EVENT, openPanel);
      window.removeEventListener(OPEN_REGISTERED_GROUP_CREATE_EVENT, openCreate);
    };
  }, [setCreateMessage]);

  useEffect(() => () => {
    if (friendIdCopyTimerRef.current !== null) window.clearTimeout(friendIdCopyTimerRef.current);
    if (inviteCopyTimerRef.current !== null) window.clearTimeout(inviteCopyTimerRef.current);
    if (deleteNoticeTimerRef.current !== null) window.clearTimeout(deleteNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    setInviteNotice(null);
    if (inviteCopyTimerRef.current !== null) window.clearTimeout(inviteCopyTimerRef.current);
  }, [selected]);

  useEffect(() => {
    if (!client || !selected) {
      setMembers([]);
      return;
    }
    void client.rpc("list_channel_participants", { target_channel_id: selected })
      .then(({ data, error }) => {
        if (error) setMessage("无法读取成员列表。");
        else {
          setMembers(((data ?? []) as ParticipantRow[]).map((row) => ({
            user_id: row.participant_id,
            role: row.role as "owner" | "member",
            auto_share_new_marks: row.auto_share_new_marks,
            kind: row.kind as "account" | "channel_only",
            profiles: { username: row.display_name },
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

  const selectedChannel = channels.find((channel) => channel.id === selected) ?? null;
  const owner = selectedChannel?.owner_user_id === user?.id;
  const myMembership = members.find((member) => member.user_id === user?.id);

  useEffect(() => {
    if (!client || !selected || !owner) {
      setInviteLinks([]);
      return;
    }
    void client.from("channel_invite_links")
      .select("id,expires_at,use_count,max_uses,revoked_at")
      .eq("channel_id", selected)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setMessage("无法读取邀请链接。");
        else setInviteLinks((data ?? []) as InviteLinkRow[]);
      });
  }, [client, owner, selected]);

  if (!client) return null;

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return requestAccountDialog();
    if (creatingRef.current) return;
    const formElement = event.currentTarget;
    const name = String(new FormData(formElement).get("name") ?? "").trim();
    if (!name) return;
    if (channels.some((channel) => channel.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setCreateMessage("你已经有一个同名观影小组。");
      return;
    }
    creatingRef.current = true;
    setBusy(true);
    const { data, error } = await client!.rpc("create_channel", { channel_name: name });
    creatingRef.current = false;
    setBusy(false);
    if (error) return setCreateMessage(error.code === "23505" ? "你已经有一个同名观影小组。" : "无法创建观影小组，请稍后重试。");
    formElement.reset();
    await load();
    createDialogRef.current?.close();
    onNavigate(data as string);
  }

  async function copyFriendId() {
    if (!friendId) return;
    try {
      await navigator.clipboard.writeText(friendId);
      setFriendIdCopied(true);
      if (friendIdCopyTimerRef.current !== null) window.clearTimeout(friendIdCopyTimerRef.current);
      friendIdCopyTimerRef.current = window.setTimeout(() => {
        setFriendIdCopied(false);
        friendIdCopyTimerRef.current = null;
      }, 3000);
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
    setMessage(enabled ? "以后新标记会默认同步到这个观影小组。" : "以后新标记不会默认同步到这个观影小组。");
  }

  async function deleteSelectedChannel() {
    if (!selectedChannel || !owner || busy) return;
    if (!window.confirm(`确定删除「${selectedChannel.name}」吗？成员关系、邀请和小组身份都会立即失效；个人账号的私人想看仍会保留。`)) return;
    setBusy(true);
    const { error } = await client!.rpc("delete_channel", { target_channel_id: selectedChannel.id });
    setBusy(false);
    if (error) return setMessage("无法删除观影小组，请稍后重试。");
    showDeleteNotice(`已删除「${selectedChannel.name}」。`);
    onNavigate(null);
    await load();
  }

  async function renameSelectedChannel() {
    if (!selectedChannel || !owner || busy) return;
    const name = window.prompt("新的观影小组名称", selectedChannel.name)?.trim();
    if (!name || name === selectedChannel.name) return;
    setBusy(true);
    const { error } = await client!.rpc("rename_channel", { target_channel_id: selectedChannel.id, new_name: name });
    setBusy(false);
    if (error) return setMessage("无法重命名观影小组。");
    await load();
    setMessage("观影小组名称已更新。");
  }

  async function transferOwnership(member: Member) {
    if (!selectedChannel || !owner || busy) return;
    const memberName = member.profiles?.username ?? "成员";
    if (!window.confirm(`确定将创建者身份转让给「${memberName}」吗？转让后你会成为普通成员。`)) return;
    setBusy(true);
    const { error } = await client!.rpc("transfer_channel_ownership", {
      target_channel_id: selectedChannel.id,
      target_kind: member.kind,
      target_participant_id: member.user_id,
    });
    setBusy(false);
    if (error) return setMessage("无法转让创建者身份。");
    await load();
    setMessage(`已将创建者身份转让给「${memberName}」。`);
  }

  async function leaveSelectedChannel() {
    if (!selectedChannel || owner || busy) return;
    if (!window.confirm(`确定退出「${selectedChannel.name}」吗？你在这个观影小组的分享会被移除，个人想看仍会保留。`)) return;
    setBusy(true);
    const { error } = await client!.rpc("leave_channel", { target_channel_id: selectedChannel.id });
    setBusy(false);
    if (error) return setMessage("无法退出观影小组，请稍后重试。");
    showDeleteNotice(`已退出「${selectedChannel.name}」。`);
    onNavigate(null);
    await load();
  }

  async function removeChannelMember(member: Member) {
    if (!selected || !owner || busy) return;
    const memberName = member.profiles?.username ?? "成员";
    const warning = member.kind === "channel_only"
      ? `确定移除「${memberName}」吗？其小组身份和全部想看都会永久删除。`
      : `确定移除 @${memberName} 吗？其在这个观影小组的分享会被移除，个人想看仍会保留。`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    const { error } = member.kind === "channel_only"
      ? await client!.rpc("remove_channel_identity_as_account", {
        target_channel_id: selected,
        target_identity_id: member.user_id,
      })
      : await client!.rpc("remove_channel_member", {
        target_channel_id: selected,
        target_user_id: member.user_id,
      });
    setBusy(false);
    if (error) return setMessage("无法移除这个成员。");
    setMembers((current) => current.filter((currentMember) => currentMember.user_id !== member.user_id));
    window.dispatchEvent(new Event("movie-together:watch-marks-changed"));
  }

  function showDeleteNotice(text: string) {
    if (deleteNoticeTimerRef.current !== null) window.clearTimeout(deleteNoticeTimerRef.current);
    setDeleteNotice({ id: Date.now(), text });
    deleteNoticeTimerRef.current = window.setTimeout(() => {
      setDeleteNotice(null);
      deleteNoticeTimerRef.current = null;
    }, 3000);
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
        showInviteNotice(result.message);
      } catch {
        showInviteNotice("无法发送邮箱邀请。");
      }
    } else {
      const { error } = await client!.rpc("invite_channel_user_by_friend_id", {
        target_channel_id: selected,
        target_friend_id: value,
      });
      showInviteNotice(error ? "没有找到这个 Friend ID，或对方已经是成员。" : "邀请已发送，等待对方接受后才会加入。");
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
    if (error || !row) return showInviteNotice("无法生成邀请链接。");
    const url = invitationUrl(row.invite_token);
    try {
      await navigator.clipboard.writeText(url);
      showInviteNotice("邀请链接已复制：7 天有效，最多 20 人加入。");
      setInviteLinks((current) => [{
        id: row.invite_link_id,
        expires_at: row.expires_at,
        use_count: 0,
        max_uses: row.max_uses,
        revoked_at: null,
      }, ...current]);
    } catch {
      showInviteNotice("无法复制邀请链接，请检查浏览器的剪贴板权限。");
    }
  }

  async function revokeLink(linkId: string) {
    setBusy(true);
    const { error } = await client!.rpc("revoke_channel_invite_link", { target_invite_link_id: linkId });
    setBusy(false);
    if (error) return showInviteNotice("无法撤销邀请链接。");
    setInviteLinks((current) => current.map((link) => link.id === linkId
      ? { ...link, revoked_at: new Date().toISOString() }
      : link));
  }

  function showInviteNotice(text: string) {
    if (inviteCopyTimerRef.current !== null) window.clearTimeout(inviteCopyTimerRef.current);
    setInviteNotice({ id: Date.now(), text });
    inviteCopyTimerRef.current = window.setTimeout(() => {
      setInviteNotice(null);
      inviteCopyTimerRef.current = null;
    }, 3000);
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
    const { error } = await client!.rpc("accept_channel_invite_link", {
      invite_token: token,
      share_existing_marks: shareExistingOnJoin,
    });
    setBusy(false);
    if (error) return setMessage("邀请已失效或人数已满。");
    clearInviteToken();
    setInvitePreview(null);
    dialogRef.current?.close();
    setMessage("已加入观影小组。");
    setShareExistingOnJoin(false);
    notifyChannelsChanged();
  }

  async function joinAsChannelIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readInviteToken();
    if (!token) return;
    const displayName = String(new FormData(event.currentTarget).get("display_name") ?? "").trim();
    setBusy(true);
    const code = await channelIdentity.joinInvite(token, displayName);
    setBusy(false);
    if (!code) return setMessage("无法加入；链接可能已失效，或显示名已被使用。");
    clearInviteToken();
    dialogRef.current?.close();
    requestIdentityCredentialsDialog();
  }

  return (
    <>
    <button
      aria-expanded={mobileOpen}
      className="channel-mobile-toggle"
      onClick={() => setMobileOpen(true)}
      type="button"
    >☰ 观影小组</button>
    <button
      aria-label="关闭观影小组"
      className={`channel-backdrop${mobileOpen ? " open" : ""}`}
      onClick={() => setMobileOpen(false)}
      type="button"
    />
    <aside className={`channel-panel${mobileOpen ? " open" : ""}${selected || mobileOpen ? " context-open" : ""}`}>
      <nav className="channel-rail-nav" aria-label="观影小组导航">
        <button
          aria-label="个人主页"
          className={`channel-rail-home${selected === null && !notificationsOpen ? " active" : ""}`}
          onClick={() => { onNavigate(null); setMobileOpen(false); }}
          title="个人主页"
          type="button"
        >我</button>
        <span className="channel-rail-divider" />
        <div className="channel-rail-list">
          {channels.map((channel) => <button
            aria-label={channel.name}
            className={selected === channel.id ? "active" : ""}
            key={channel.id}
            onClick={() => { onNavigate(channel.id); setMobileOpen(false); }}
            title={channel.name}
            type="button"
          >{channel.name.trim().slice(0, 2)}</button>)}
        </div>
        {user && <button
          aria-label="新建观影小组"
          className="channel-rail-create"
          onClick={() => { setCreateMessage(null); setMobileOpen(false); createDialogRef.current?.showModal(); }}
          title="新建观影小组"
          type="button"
        >＋</button>}
      </nav>

      <section className="channel-context">
        <div className="channel-heading">
          <h2>观影小组</h2>
          <button className="channel-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button>
        </div>
        <div className="channel-context-scroll">
          {!user && <div className="channel-heading-actions">
            <button onClick={requestChannelCreateDialog} type="button">创建观影小组</button>
            <p>建立只有受邀成员可见的共享想看空间。</p>
          </div>}
          {user && <>
            {!selectedChannel ? <div className="channel-personal-summary">
              <span className="eyebrow dark">PERSONAL</span>
              <h3>个人主页</h3>
              <p>这里会显示全部排片和你标记过的想看场次。</p>
            </div> : <div className="channel-detail">
              <span className="eyebrow dark">PRIVATE GROUP</span>
              <h3>{selectedChannel.name}</h3>
              <label className="auto-share-setting">
                <input checked={myMembership?.auto_share_new_marks ?? false} onChange={(event) => void setAutoShare(event.target.checked)} type="checkbox" />
                新标记默认同步到这里
              </label>
              <div className="channel-member-list">
                <b>组内成员 · {members.length}</b>
                {members.map((member) => {
                  const memberName = member.profiles?.username ?? "成员";
                  return <div className="channel-member-row" key={member.user_id}>
                    <span style={{ background: avatarColor(memberName) }}>{memberName[0]?.toUpperCase()}</span>
                    <strong>{member.kind === "channel_only" ? memberName : `@${memberName}`}</strong>
                    {member.kind === "channel_only" && <small>小组身份</small>}
                    {member.role === "owner" && <small>创建者</small>}
                    {owner && member.role === "member" && <>
                      <button aria-label={`转让给 ${memberName}`} disabled={busy} onClick={() => void transferOwnership(member)} type="button">设为创建者</button>
                      <button aria-label={`移除 ${memberName}`} disabled={busy} onClick={() => void removeChannelMember(member)} type="button">移除</button>
                    </>}
                  </div>;
                })}
              </div>
              {owner && <>
                <button disabled={busy} onClick={() => void renameSelectedChannel()} type="button">重命名</button>
                <button className="delete-channel" disabled={busy} onClick={() => void deleteSelectedChannel()} type="button">删除观影小组</button>
              </>}
              {!owner && <button className="leave-channel" disabled={busy} onClick={() => void leaveSelectedChannel()} type="button">退出观影小组</button>}
            </div>}
            {message && <p className="channel-message" role="status">{message}</p>}
          </>}
        </div>
        {user && owner && selectedChannel && <div className="channel-invite-footer">
          <b>邀请成员</b>
          <form className="channel-invite" onSubmit={inviteUser}>
            <select name="kind"><option value="friend_id">Friend ID</option><option value="email">邮箱</option></select>
            <input name="identifier" placeholder="输入准确账号标识" required />
            <button disabled={busy} type="submit">邀请</button>
          </form>
          <button className="copy-invite" disabled={busy} onClick={() => void createLink()} type="button">复制分享链接</button>
          {inviteLinks.filter((link) => !link.revoked_at).map((link) => <div className="identity-invite-link" key={link.id}>
            <small>{link.use_count}/{link.max_uses} 次 · {new Date(link.expires_at).toLocaleDateString("zh-CN")}</small>
            <button disabled={busy} onClick={() => void revokeLink(link.id)} type="button">撤销</button>
          </div>)}
          {inviteNotice && <p className="invite-copy-notice" key={inviteNotice.id} role="status">{inviteNotice.text}</p>}
        </div>}
        {user && <div className="channel-user-footer">
          <strong>@{username ?? "user"}</strong>
          <div className="friend-id">
            <span>Friend ID</span>
            <div className="friend-id-value">
              <code>{friendId ?? "读取中…"}</code>
              <button disabled={!friendId} onClick={() => void copyFriendId()} type="button">
                {friendIdCopied ? "已复制" : "复制"}
              </button>
            </div>
          </div>
        </div>}
      </section>

      <dialog className="channel-create-dialog" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} onClose={() => setCreateMessage(null)} ref={createDialogRef}>
        <form className="dialog-close" method="dialog"><button aria-label="关闭" type="submit">×</button></form>
        <span className="eyebrow dark">NEW PRIVATE GROUP</span>
        <h2>创建观影小组</h2>
        <p>建立一个只有受邀成员可见的共享想看空间。个人账号的想看默认仅自己可见，再由你选择分享。</p>
        <div className="channel-create-friend-id">
          <span>个人 Friend ID</span>
          <div>
            <code>{friendId ?? "读取中…"}</code>
            <button disabled={!friendId} onClick={() => void copyFriendId()} type="button">
              {friendIdCopied ? "已复制" : "复制"}
            </button>
          </div>
        </div>
        <form className="channel-create-modal-form" onSubmit={createChannel}>
          <label>观影小组名称<input autoFocus maxLength={80} name="name" placeholder="例如：周末电影小组" required /></label>
          {createMessage && <p className="channel-create-message" role="status">{createMessage}</p>}
          <button disabled={busy} type="submit">{busy ? "创建中…" : "创建观影小组"}</button>
        </form>
      </dialog>

      <dialog className="auth-dialog invite-dialog" ref={dialogRef}>
        <form className="dialog-close" method="dialog"><button aria-label="关闭" type="submit">×</button></form>
        <h2>{invitePreview ? `加入「${invitePreview.channelName}」` : "邀请已失效"}</h2>
        {invitePreview ? <>
          <p className="privacy-note">这是只有受邀成员可见的观影小组。加入后可以看到组员分享的想看场次。</p>
          {user && <label className="invite-share-existing">
            <input checked={shareExistingOnJoin} onChange={(event) => setShareExistingOnJoin(event.target.checked)} type="checkbox" />
            <span><b>同步现有的全部个人标记</b><small>不勾选也能加入，以后可逐条手动分享。</small></span>
          </label>}
          <button className="auth-submit" disabled={busy} onClick={() => void acceptLink()} type="button">{user ? "用个人账号加入" : "用个人账号登录 / 注册后加入"}</button>
          {!user && <form className="auth-form guest-form" onSubmit={joinAsChannelIdentity}>
            <h3>使用小组身份（无需邮箱）</h3>
            <label>昵称<input maxLength={40} name="display_name" required /><small>创建后不可修改</small></label>
            <p className="privacy-note">此身份只能绑定同一个观影小组，所有想看都会直接分享。个人代码丢失后无法找回；以后可升级为个人账号并保留小组和想看。</p>
            <button className="auth-submit" disabled={busy} type="submit">创建小组身份并加入</button>
          </form>}
        </> : <p>请重新打开有效的邀请链接。</p>}
      </dialog>
    </aside>
    {deleteNotice && <div className="channel-delete-toast" key={deleteNotice.id} role="status">{deleteNotice.text}</div>}
    </>
  );
}
