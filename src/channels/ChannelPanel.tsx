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
import { useI18n } from "../i18n/I18nContext";

type Member = { user_id: string; role: "owner" | "member"; auto_share_new_marks: boolean; kind: "account" | "channel_only"; profiles: { username: string } | null };
type ParticipantRow = { participant_id: string; display_name: string; role: string; kind: string; auto_share_new_marks: boolean };
type InviteLinkRow = { id: string; expires_at: string; use_count: number; max_uses: number; revoked_at: string | null };

type ChannelPanelProps = {
  activeChannelId: string | null;
  notificationsOpen: boolean;
  onNavigate: (channelId: string | null) => void;
  onPanelOpenChange?: (open: boolean) => void;
};

export function ChannelPanel(props: ChannelPanelProps) {
  const { identity } = useChannelIdentity();
  return identity ? <ChannelIdentityPanel {...props} /> : <RegisteredChannelPanel {...props} />;
}

function RegisteredChannelPanel({ activeChannelId, notificationsOpen, onNavigate, onPanelOpenChange }: ChannelPanelProps) {
  const client = supabase;
  const { user, username } = useAuth();
  const { copy, locale } = useI18n();
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
      setMessage(copy("无法读取观影小组，请稍后重试。", "Could not load Film Fams. Please try again."));
      return;
    }
    const nextChannels = channelResult.data as Channel[];
    setChannels(nextChannels);
    setFriendId(friendResult.data as string);
    if (activeChannelId && !nextChannels.some((channel) => channel.id === activeChannelId)) onNavigate(null);
  }, [activeChannelId, client, copy, onNavigate, user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    window.addEventListener(CHANNELS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CHANNELS_CHANGED_EVENT, load);
  }, [load]);

  useEffect(() => {
    const openPanel = () => setMobileOpen((current) => !current);
    const openCreate = () => { setCreateMessage(null); setMobileOpen(false); createDialogRef.current?.showModal(); };
    window.addEventListener(OPEN_GROUP_PANEL_EVENT, openPanel);
    window.addEventListener(OPEN_REGISTERED_GROUP_CREATE_EVENT, openCreate);
    return () => {
      window.removeEventListener(OPEN_GROUP_PANEL_EVENT, openPanel);
      window.removeEventListener(OPEN_REGISTERED_GROUP_CREATE_EVENT, openCreate);
    };
  }, [setCreateMessage]);

  useEffect(() => {
    onPanelOpenChange?.(mobileOpen);
  }, [mobileOpen, onPanelOpenChange]);

  useEffect(() => () => onPanelOpenChange?.(false), [onPanelOpenChange]);

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
        if (error) setMessage(copy("无法读取成员列表。", "Could not load the member list."));
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
  }, [client, copy, selected]);

  useEffect(() => {
    const token = readInviteToken();
    if (!client || !token) return;
    void callInvitationFunction<{ invite: InvitePreview }>(client, { action: "preview", inviteToken: token })
      .then(({ invite }) => {
        setInvitePreview(invite);
        dialogRef.current?.showModal();
      })
      .catch(() => {
        setMessage(copy("邀请链接无效或已过期。", "This invitation link is invalid or expired."));
        clearInviteToken();
      });
  }, [client, copy, user]);

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
        if (error) setMessage(copy("无法读取邀请链接。", "Could not load invitation links."));
        else setInviteLinks((data ?? []) as InviteLinkRow[]);
      });
  }, [client, copy, owner, selected]);

  if (!client) return null;

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return requestAccountDialog();
    if (creatingRef.current) return;
    const formElement = event.currentTarget;
    const name = String(new FormData(formElement).get("name") ?? "").trim();
    if (!name) return;
    if (channels.some((channel) => channel.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setCreateMessage(copy("你已经有一个同名观影小组。", "You already have a Film Fam with this name."));
      return;
    }
    creatingRef.current = true;
    setBusy(true);
    const { data, error } = await client!.rpc("create_channel", { channel_name: name });
    creatingRef.current = false;
    setBusy(false);
    if (error) return setCreateMessage(error.code === "23505"
      ? copy("你已经有一个同名观影小组。", "You already have a Film Fam with this name.")
      : copy("无法创建观影小组，请稍后重试。", "Could not create the Film Fam. Please try again."));
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
      setMessage(copy("无法复制 Friend ID，请检查浏览器的剪贴板权限。", "Could not copy the Friend ID. Check your browser’s clipboard permission."));
    }
  }

  async function setAutoShare(enabled: boolean) {
    if (!selected) return;
    const { error } = await client!.rpc("set_channel_auto_share", {
      target_channel_id: selected,
      enabled,
    });
    if (error) return setMessage(copy("无法更新默认同步设置。", "Could not update the default sharing setting."));
    setMembers((current) => current.map((member) => member.user_id === user?.id
      ? { ...member, auto_share_new_marks: enabled }
      : member));
    setMessage(enabled
      ? copy("以后新标记会默认同步到这个观影小组。", "New marks will be shared with this Film Fam by default.")
      : copy("以后新标记不会默认同步到这个观影小组。", "New marks will no longer be shared with this Film Fam by default."));
  }

  async function deleteSelectedChannel() {
    if (!selectedChannel || !owner || busy) return;
    if (!window.confirm(copy(
      `确定删除「${selectedChannel.name}」吗？成员关系、邀请和小组身份都会立即失效；个人账号的私人想看仍会保留。`,
      `Delete “${selectedChannel.name}”? Memberships, invitations, and Film Fam profiles will stop working immediately; private personal marks will remain.`,
    ))) return;
    setBusy(true);
    const { error } = await client!.rpc("delete_channel", { target_channel_id: selectedChannel.id });
    setBusy(false);
    if (error) return setMessage(copy("无法删除观影小组，请稍后重试。", "Could not delete the Film Fam. Please try again."));
    showDeleteNotice(copy(`已删除「${selectedChannel.name}」。`, `Deleted “${selectedChannel.name}”.`));
    onNavigate(null);
    await load();
  }

  async function renameSelectedChannel() {
    if (!selectedChannel || !owner || busy) return;
    const name = window.prompt(copy("新的观影小组名称", "New Film Fam name"), selectedChannel.name)?.trim();
    if (!name || name === selectedChannel.name) return;
    setBusy(true);
    const { error } = await client!.rpc("rename_channel", { target_channel_id: selectedChannel.id, new_name: name });
    setBusy(false);
    if (error) return setMessage(copy("无法重命名观影小组。", "Could not rename the Film Fam."));
    await load();
    setMessage(copy("观影小组名称已更新。", "Film Fam name updated."));
  }

  async function transferOwnership(member: Member) {
    if (!selectedChannel || !owner || busy) return;
    const memberName = member.profiles?.username ?? copy("成员", "Member");
    if (!window.confirm(copy(`确定将组长身份转让给「${memberName}」吗？转让后你会成为普通成员。`, `Make “${memberName}” the Organizer? You will become a Member.`))) return;
    setBusy(true);
    const { error } = await client!.rpc("transfer_channel_ownership", {
      target_channel_id: selectedChannel.id,
      target_kind: member.kind,
      target_participant_id: member.user_id,
    });
    setBusy(false);
    if (error) return setMessage(copy("无法转让组长身份。", "Could not transfer the Organizer role."));
    await load();
    setMessage(copy(`已将组长身份转让给「${memberName}」。`, `“${memberName}” is now the Organizer.`));
  }

  async function leaveSelectedChannel() {
    if (!selectedChannel || owner || busy) return;
    if (!window.confirm(copy(`确定退出「${selectedChannel.name}」吗？你在这个观影小组的分享会被移除，个人想看仍会保留。`, `Leave “${selectedChannel.name}”? Your shares in this Film Fam will be removed, but personal marks will remain.`))) return;
    setBusy(true);
    const { error } = await client!.rpc("leave_channel", { target_channel_id: selectedChannel.id });
    setBusy(false);
    if (error) return setMessage(copy("无法退出观影小组，请稍后重试。", "Could not leave the Film Fam. Please try again."));
    showDeleteNotice(copy(`已退出「${selectedChannel.name}」。`, `Left “${selectedChannel.name}”.`));
    onNavigate(null);
    await load();
  }

  async function removeChannelMember(member: Member) {
    if (!selected || !owner || busy) return;
    const memberName = member.profiles?.username ?? copy("成员", "Member");
    const warning = member.kind === "channel_only"
      ? copy(`确定移除「${memberName}」吗？其小组身份和全部想看都会永久删除。`, `Remove “${memberName}”? Their Film Fam profile and every mark will be permanently deleted.`)
      : copy(`确定移除 @${memberName} 吗？其在这个观影小组的分享会被移除，个人想看仍会保留。`, `Remove @${memberName}? Their shares in this Film Fam will be removed, but their personal marks will remain.`);
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
    if (error) return setMessage(copy("无法移除这个成员。", "Could not remove this member."));
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
        showInviteNotice(copy("无法发送邮箱邀请。", "Could not send the email invitation."));
      }
    } else {
      const { error } = await client!.rpc("invite_channel_user_by_friend_id", {
        target_channel_id: selected,
        target_friend_id: value,
      });
      showInviteNotice(error
        ? copy("没有找到这个 Friend ID，或对方已经是成员。", "This Friend ID was not found, or the person is already a member.")
        : copy("邀请已发送，等待对方接受后才会加入。", "Invitation sent. They will join after accepting it."));
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
    if (error || !row) return showInviteNotice(copy("无法生成邀请链接。", "Could not create an invitation link."));
    const url = invitationUrl(row.invite_token);
    try {
      await navigator.clipboard.writeText(url);
      showInviteNotice(copy("邀请链接已复制：7 天有效，最多 20 人加入。", "Invitation link copied. It is valid for 7 days and up to 20 joins."));
      setInviteLinks((current) => [{
        id: row.invite_link_id,
        expires_at: row.expires_at,
        use_count: 0,
        max_uses: row.max_uses,
        revoked_at: null,
      }, ...current]);
    } catch {
      showInviteNotice(copy("无法复制邀请链接，请检查浏览器的剪贴板权限。", "Could not copy the invitation link. Check your browser’s clipboard permission."));
    }
  }

  async function revokeLink(linkId: string) {
    setBusy(true);
    const { error } = await client!.rpc("revoke_channel_invite_link", { target_invite_link_id: linkId });
    setBusy(false);
    if (error) return showInviteNotice(copy("无法撤销邀请链接。", "Could not revoke the invitation link."));
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
    if (error) return setMessage(copy("邀请已失效或人数已满。", "The invitation has expired or the Film Fam is full."));
    clearInviteToken();
    setInvitePreview(null);
    dialogRef.current?.close();
    setMessage(copy("已加入观影小组。", "Joined the Film Fam."));
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
    if (!code) return setMessage(copy("无法加入；链接可能已失效，或显示名已被使用。", "Could not join. The link may have expired, or that display name may already be in use."));
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
    >{copy("☰ 观影小组", "☰ Film Fam")}</button>
    <button
      aria-label={copy("关闭观影小组", "Close Film Fam")}
      className={`channel-backdrop${mobileOpen ? " open" : ""}`}
      onClick={() => setMobileOpen(false)}
      type="button"
    />
    <aside className={`channel-panel${mobileOpen ? " open" : ""}${selected || mobileOpen ? " context-open" : ""}`}>
      <nav className="channel-rail-nav" aria-label={copy("观影小组导航", "Film Fam navigation")}>
        <button
          aria-label={copy("返回排片", "Back to schedule")}
          className={`channel-rail-home${selected === null && !notificationsOpen ? " active" : ""}`}
          onClick={() => { onNavigate(null); setMobileOpen(false); }}
          title={copy("返回排片", "Back to schedule")}
          type="button"
        >{copy("我", "Me")}</button>
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
          {user && <button
            aria-label={copy("新建观影小组", "Create a Film Fam")}
            className="channel-rail-create"
            onClick={() => { setCreateMessage(null); setMobileOpen(false); createDialogRef.current?.showModal(); }}
            title={copy("新建观影小组", "Create a Film Fam")}
            type="button"
          >＋</button>}
        </div>
      </nav>

      <section className="channel-context">
        <div className="channel-heading">
          <h2>{copy("观影小组", "Film Fams")}</h2>
          {mobileOpen && <button aria-label={copy("关闭观影小组", "Close Film Fam")} className="channel-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button>}
        </div>
        <div className="channel-context-scroll">
          {!user && <div className="channel-heading-actions">
            <button onClick={requestChannelCreateDialog} type="button">{copy("创建观影小组", "Create a Film Fam")}</button>
            <p>{copy("建立只有受邀成员可见的共享想看空间。", "Create a shared want-to-watch space visible only to invited members.")}</p>
          </div>}
          {user && <>
            {!selectedChannel ? <div className="channel-group-overview">
              <span className="eyebrow dark">YOUR GROUPS</span>
              <h3>{channels.length > 0 ? copy(`${channels.length} 个观影小组`, `${channels.length} Film Fams`) : copy("还没有观影小组", "No Film Fams yet")}</h3>
              <p>{channels.length > 0
                ? copy("选择一个小组，查看成员、分享设置和邀请方式。", "Choose a Film Fam to see members, sharing settings, and invitations.")
                : copy("创建一个观影小组，或通过朋友发来的邀请链接加入。", "Create a Film Fam or join with a friend’s invitation link.")}</p>
              {channels.length > 0 ? <div className="channel-overview-list">
                {channels.map((channel) => <button
                  key={channel.id}
                  onClick={() => { onNavigate(channel.id); setMobileOpen(false); }}
                  type="button"
                >
                  <strong>{channel.name}</strong>
                  <small>{channel.owner_user_id === user.id ? copy("组长", "Organizer") : copy("成员", "Member")}</small>
                </button>)}
              </div> : <button
                className="channel-overview-create"
                onClick={() => { setCreateMessage(null); setMobileOpen(false); createDialogRef.current?.showModal(); }}
                type="button"
              >{copy("创建观影小组", "Create a Film Fam")}</button>}
            </div> : <div className="channel-detail">
              <span className="eyebrow dark">PRIVATE GROUP</span>
              <div className="channel-title-row">
                <h3>{selectedChannel.name}</h3>
                {owner && <button className="channel-rename" disabled={busy} onClick={() => void renameSelectedChannel()} type="button">{copy("重命名", "Rename")}</button>}
              </div>
              <label className="auto-share-setting">
                <input checked={myMembership?.auto_share_new_marks ?? false} onChange={(event) => void setAutoShare(event.target.checked)} type="checkbox" />
                {copy("新标记默认同步到这里", "Share new marks here by default")}
              </label>
              <div className="channel-member-list">
                <b>{copy(`组内成员 · ${members.length}`, `Film Fam members · ${members.length}`)}</b>
                {members.map((member) => {
                  const memberName = member.profiles?.username ?? copy("成员", "Member");
                  return <div className="channel-member-row" key={member.user_id}>
                    <span style={{ background: avatarColor(memberName) }}>{memberName[0]?.toUpperCase()}</span>
                    <strong>{member.kind === "channel_only" ? memberName : `@${memberName}`}</strong>
                    {member.kind === "channel_only" && <small>{copy("小组身份", "Film Fam profile")}</small>}
                    {member.role === "owner" && <small>{copy("组长", "Organizer")}</small>}
                    {owner && member.role === "member" && <>
                      <button aria-label={copy(`转让组长给 ${memberName}`, `Make ${memberName} the Organizer`)} disabled={busy} onClick={() => void transferOwnership(member)} type="button">{copy("设为组长", "Make Organizer")}</button>
                      <button aria-label={copy(`移除 ${memberName}`, `Remove ${memberName}`)} disabled={busy} onClick={() => void removeChannelMember(member)} type="button">{copy("移除", "Remove")}</button>
                    </>}
                  </div>;
                })}
              </div>
              {owner && <>
                <button className="delete-channel" disabled={busy} onClick={() => void deleteSelectedChannel()} type="button">{copy("删除观影小组", "Delete Film Fam")}</button>
              </>}
              {!owner && <button className="leave-channel" disabled={busy} onClick={() => void leaveSelectedChannel()} type="button">{copy("退出观影小组", "Leave Film Fam")}</button>}
            </div>}
            {message && <p className="channel-message" role="status">{message}</p>}
          </>}
        </div>
        {user && owner && selectedChannel && <div className="channel-invite-footer">
          <b>{copy("邀请成员", "Invite members")}</b>
          <form className="channel-invite" onSubmit={inviteUser}>
            <select name="kind"><option value="friend_id">Friend ID</option><option value="email">{copy("邮箱", "Email")}</option></select>
            <input name="identifier" placeholder={copy("输入准确账号标识", "Enter the exact account identifier")} required />
            <button disabled={busy} type="submit">{copy("邀请", "Invite")}</button>
          </form>
          <button className="copy-invite" disabled={busy} onClick={() => void createLink()} type="button">{copy("复制分享链接", "Copy invitation link")}</button>
          {inviteLinks.filter((link) => !link.revoked_at).map((link) => <div className="identity-invite-link" key={link.id}>
            <small>{copy(`${link.use_count}/${link.max_uses} 次`, `${link.use_count}/${link.max_uses} uses`)} · {new Date(link.expires_at).toLocaleDateString(locale)}</small>
            <button disabled={busy} onClick={() => void revokeLink(link.id)} type="button">{copy("撤销", "Revoke")}</button>
          </div>)}
          {inviteNotice && <p className="invite-copy-notice" key={inviteNotice.id} role="status">{inviteNotice.text}</p>}
        </div>}
        {user && <div className="channel-user-footer">
          <strong>@{username ?? "user"}</strong>
          <div className="friend-id">
            <span>Friend ID</span>
            <div className="friend-id-value">
              <code>{friendId ?? copy("读取中…", "Loading…")}</code>
              <button disabled={!friendId} onClick={() => void copyFriendId()} type="button">
                {friendIdCopied ? copy("已复制", "Copied") : copy("复制", "Copy")}
              </button>
            </div>
          </div>
        </div>}
      </section>

      <dialog className="channel-create-dialog" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} onClose={() => setCreateMessage(null)} ref={createDialogRef}>
        <form className="dialog-close" method="dialog"><button aria-label={copy("关闭", "Close")} type="submit">×</button></form>
        <span className="eyebrow dark">NEW PRIVATE GROUP</span>
        <h2>{copy("创建观影小组", "Create a Film Fam")}</h2>
        <p>{copy("建立一个只有受邀成员可见的共享想看空间。个人账号的想看默认仅自己可见，再由你选择分享。", "Create a shared want-to-watch space visible only to invited members. Personal-account marks start private, and you choose what to share.")}</p>
        <div className="channel-create-friend-id">
          <span>{copy("个人 Friend ID", "Personal Friend ID")}</span>
          <div>
            <code>{friendId ?? copy("读取中…", "Loading…")}</code>
            <button disabled={!friendId} onClick={() => void copyFriendId()} type="button">
              {friendIdCopied ? copy("已复制", "Copied") : copy("复制", "Copy")}
            </button>
          </div>
        </div>
        <form className="channel-create-modal-form" onSubmit={createChannel}>
          <label>{copy("观影小组名称", "Film Fam name")}<input autoFocus maxLength={80} name="name" placeholder={copy("例如：周末电影小组", "For example: Weekend Movies")} required /></label>
          {createMessage && <p className="channel-create-message" role="status">{createMessage}</p>}
          <button disabled={busy} type="submit">{busy ? copy("创建中…", "Creating…") : copy("创建观影小组", "Create a Film Fam")}</button>
        </form>
      </dialog>

      <dialog className="auth-dialog invite-dialog" ref={dialogRef}>
        <form className="dialog-close" method="dialog"><button aria-label={copy("关闭", "Close")} type="submit">×</button></form>
        <h2>{invitePreview ? copy(`加入「${invitePreview.channelName}」`, `Join “${invitePreview.channelName}”`) : copy("邀请已失效", "Invitation expired")}</h2>
        {invitePreview ? <>
          <p className="privacy-note">{copy("这是只有受邀成员可见的观影小组。加入后可以看到组员分享的想看场次。", "This Film Fam is visible only to invited members. After joining, you can see showtimes members share.")}</p>
          {user && <label className="invite-share-existing">
            <input checked={shareExistingOnJoin} onChange={(event) => setShareExistingOnJoin(event.target.checked)} type="checkbox" />
            <span><b>{copy("同步现有的全部个人标记", "Share all existing personal marks")}</b><small>{copy("不勾选也能加入，以后可逐条手动分享。", "You can join without this and share individual marks later.")}</small></span>
          </label>}
          <button className="auth-submit" disabled={busy} onClick={() => void acceptLink()} type="button">{user ? copy("用个人账号加入", "Join with personal account") : copy("用个人账号登录 / 注册后加入", "Sign in or create a personal account to join")}</button>
          {!user && <form className="auth-form guest-form" onSubmit={joinAsChannelIdentity}>
            <h3>{copy("使用小组身份（无需邮箱）", "Use a Film Fam profile (no email required)")}</h3>
            <label>{copy("昵称", "Display name")}<input maxLength={40} name="display_name" required /><small>{copy("创建后不可修改", "Cannot be changed after creation")}</small></label>
            <p className="privacy-note">{copy("此身份只能绑定同一个观影小组，所有想看都会直接分享。个人代码丢失后无法找回；以后可升级为个人账号并保留小组和想看。", "This profile belongs to one Film Fam, and every mark is shared directly. A lost personal code cannot be recovered; you can upgrade later and keep your Film Fam and marks.")}</p>
            <button className="auth-submit" disabled={busy} type="submit">{copy("创建小组身份并加入", "Create Film Fam profile and join")}</button>
          </form>}
        </> : <p>{copy("请重新打开有效的邀请链接。", "Open a valid invitation link again.")}</p>}
      </dialog>
    </aside>
    {deleteNotice && <div className="channel-delete-toast" key={deleteNotice.id} role="status">{deleteNotice.text}</div>}
    </>
  );
}
