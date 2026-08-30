import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OPEN_GROUP_PANEL_EVENT, OPEN_REGISTERED_GROUP_CREATE_EVENT, requestAccountDialog, requestChannelCreateDialog } from "../auth/account-events";
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
import { useI18n } from "../i18n/I18nContext";

type Member = { user_id: string; role: "owner" | "member"; profiles: { username: string } | null };
type ParticipantRow = { participant_id: string; display_name: string; role: string };
type InviteLinkRow = { id: string; revoked_at: string | null };

type ChannelPanelProps = {
  activeChannelId: string | null;
  notificationsOpen: boolean;
  onNavigate: (channelId: string | null) => void;
  onPanelOpenChange?: (open: boolean) => void;
};

export function ChannelPanel({ activeChannelId, notificationsOpen, onNavigate, onPanelOpenChange }: ChannelPanelProps) {
  const client = supabase;
  const { user, username } = useAuth();
  const { copy } = useI18n();
  const inviteDialogRef = useRef<HTMLDialogElement>(null);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const creatingRef = useRef(false);
  const inviteCopyTimerRef = useRef<number | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteLinks, setInviteLinks] = useState<InviteLinkRow[]>([]);
  const [message, setMessage] = useTransientMessage();
  const [createMessage, setCreateMessage] = useTransientMessage();
  const [busy, setBusy] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !user) {
      setChannels([]);
      return;
    }
    const { data, error } = await client.from("channels").select("id,name,owner_user_id").order("created_at");
    if (error) return setMessage(copy("无法读取观影小组，请稍后重试。", "Could not load Film Fams. Please try again."));
    const next = (data ?? []) as Channel[];
    setChannels(next);
    if (activeChannelId && !next.some((channel) => channel.id === activeChannelId)) onNavigate(null);
  }, [activeChannelId, client, copy, onNavigate, setMessage, user]);

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
  useEffect(() => { onPanelOpenChange?.(mobileOpen); }, [mobileOpen, onPanelOpenChange]);
  useEffect(() => () => onPanelOpenChange?.(false), [onPanelOpenChange]);
  useEffect(() => () => {
    if (inviteCopyTimerRef.current !== null) window.clearTimeout(inviteCopyTimerRef.current);
  }, []);

  const selectedChannel = channels.find((channel) => channel.id === activeChannelId) ?? null;
  const owner = selectedChannel?.owner_user_id === user?.id;

  useEffect(() => {
    if (!client || !activeChannelId) return setMembers([]);
    void client.rpc("list_channel_participants", { target_channel_id: activeChannelId }).then(({ data, error }) => {
      if (error) return setMessage(copy("无法读取成员列表。", "Could not load the member list."));
      setMembers(((data ?? []) as ParticipantRow[]).map((row) => ({
        user_id: row.participant_id,
        role: row.role as "owner" | "member",
        profiles: { username: row.display_name },
      })));
    });
  }, [activeChannelId, client, copy, setMessage]);

  useEffect(() => {
    if (!client || !activeChannelId || !owner) return setInviteLinks([]);
    void client.from("channel_invite_links").select("id,revoked_at").eq("channel_id", activeChannelId)
      .order("created_at", { ascending: false }).then(({ data, error }) => {
        if (error) return setMessage(copy("无法读取邀请链接。", "Could not load invitation links."));
        setInviteLinks((data ?? []) as InviteLinkRow[]);
      });
  }, [activeChannelId, client, copy, owner, setMessage]);

  useEffect(() => {
    const token = readInviteToken();
    if (!client || !token) return;
    void callInvitationFunction<{ invite: InvitePreview }>(client, { action: "preview", inviteToken: token })
      .then(({ invite }) => {
        setInvitePreview(invite);
        inviteDialogRef.current?.showModal();
      })
      .catch(() => {
        setMessage(copy("邀请链接无效或已被撤销。", "This invitation link is invalid or revoked."));
        clearInviteToken();
      });
  }, [client, copy, setMessage, user]);

  if (!client) return null;
  const activeClient = client;

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return requestAccountDialog();
    if (creatingRef.current) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    if (channels.some((channel) => channel.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return setCreateMessage(copy("你已经有一个同名观影小组。", "You already have a Film Fam with this name."));
    }
    creatingRef.current = true;
    setBusy(true);
    const { data, error } = await activeClient.rpc("create_channel", { channel_name: name });
    creatingRef.current = false;
    setBusy(false);
    if (error) return setCreateMessage(copy("无法创建观影小组，请稍后重试。", "Could not create the Film Fam. Please try again."));
    form.reset();
    await load();
    createDialogRef.current?.close();
    onNavigate(data as string);
  }

  async function renameSelectedChannel() {
    if (!selectedChannel || !owner || busy) return;
    const name = window.prompt(copy("新的观影小组名称", "New Film Fam name"), selectedChannel.name)?.trim();
    if (!name || name === selectedChannel.name) return;
    setBusy(true);
    const { error } = await activeClient.rpc("rename_channel", { target_channel_id: selectedChannel.id, new_name: name });
    setBusy(false);
    if (error) return setMessage(copy("无法重命名观影小组。", "Could not rename the Film Fam."));
    await load();
  }

  async function deleteSelectedChannel() {
    if (!selectedChannel || !owner || busy) return;
    if (!window.confirm(copy(`确定删除「${selectedChannel.name}」吗？成员关系、邀请和小组分享都会永久删除；成员的私人想看仍会保留。`, `Delete “${selectedChannel.name}”? Memberships, invitations, and shares will be permanently deleted; members keep their private marks.`))) return;
    setBusy(true);
    const { error } = await activeClient.rpc("delete_channel", { target_channel_id: selectedChannel.id });
    setBusy(false);
    if (error) return setMessage(copy("无法删除观影小组。", "Could not delete the Film Fam."));
    onNavigate(null);
    await load();
  }

  async function transferOwnership(member: Member) {
    if (!selectedChannel || !owner || busy) return;
    const name = member.profiles?.username ?? copy("成员", "Member");
    if (!window.confirm(copy(`确定将组长转让给 @${name} 吗？`, `Make @${name} the Organizer?`))) return;
    setBusy(true);
    const { error } = await activeClient.rpc("transfer_channel_ownership", {
      target_channel_id: selectedChannel.id,
      target_participant_id: member.user_id,
    });
    setBusy(false);
    if (error) return setMessage(copy("无法转让组长。", "Could not transfer the Organizer role."));
    await load();
  }

  async function removeMember(member: Member) {
    if (!selectedChannel || !owner || busy) return;
    const name = member.profiles?.username ?? copy("成员", "Member");
    if (!window.confirm(copy(`移除 @${name}？其私人想看会保留，但在这个小组的分享会被删除。`, `Remove @${name}? Their private marks remain, but their shares in this Film Fam will be removed.`))) return;
    setBusy(true);
    const { error } = await activeClient.rpc("remove_channel_member", { target_channel_id: selectedChannel.id, target_user_id: member.user_id });
    setBusy(false);
    if (error) return setMessage(copy("无法移除成员。", "Could not remove this member."));
    setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
  }

  async function leaveChannel() {
    if (!selectedChannel || owner || busy) return;
    if (!window.confirm(copy(`退出「${selectedChannel.name}」？你的私人想看会保留，小组分享会被删除。`, `Leave “${selectedChannel.name}”? Your private marks remain and your Film Fam shares will be removed.`))) return;
    setBusy(true);
    const { error } = await activeClient.rpc("leave_channel", { target_channel_id: selectedChannel.id });
    setBusy(false);
    if (error) return setMessage(copy("无法退出观影小组。", "Could not leave the Film Fam."));
    onNavigate(null);
    await load();
  }

  async function createLink() {
    if (!selectedChannel || !owner || busy) return;
    setBusy(true);
    const { data, error } = await activeClient.rpc("create_channel_invite_link", { target_channel_id: selectedChannel.id });
    setBusy(false);
    const row = data?.[0] as { invite_link_id?: string; invite_token?: string } | undefined;
    if (error || !row?.invite_token) return setMessage(copy("无法创建邀请链接。", "Could not create an invitation link."));
    await navigator.clipboard.writeText(invitationUrl(row.invite_token));
    setInviteNotice(copy("邀请链接已复制；它会一直有效，直到你撤销或生成新链接。", "Invitation link copied. It remains valid until you revoke or replace it."));
    setInviteLinks([{ id: row.invite_link_id!, revoked_at: null }]);
    if (inviteCopyTimerRef.current !== null) window.clearTimeout(inviteCopyTimerRef.current);
    inviteCopyTimerRef.current = window.setTimeout(() => setInviteNotice(null), 4000);
  }

  async function revokeLink(linkId: string) {
    setBusy(true);
    const { error } = await activeClient.rpc("revoke_channel_invite_link", { target_invite_link_id: linkId });
    setBusy(false);
    if (error) return setMessage(copy("无法撤销邀请链接。", "Could not revoke the invitation link."));
    setInviteLinks((current) => current.map((link) => link.id === linkId ? { ...link, revoked_at: new Date().toISOString() } : link));
  }

  async function acceptLink() {
    const token = readInviteToken();
    if (!user) {
      inviteDialogRef.current?.close();
      requestAccountDialog();
      return;
    }
    if (!token || busy) return;
    setBusy(true);
    const { data, error } = await activeClient.rpc("accept_channel_invite_link", { invite_token: token });
    setBusy(false);
    if (error) return setMessage(copy("邀请链接无效或已被撤销。", "This invitation link is invalid or revoked."));
    clearInviteToken();
    inviteDialogRef.current?.close();
    setInvitePreview(null);
    await load();
    notifyChannelsChanged();
    onNavigate(data as string);
  }

  return <>
    <aside className={`channel-panel${mobileOpen ? " mobile-open" : ""}`}>
      <nav className="channel-rail" aria-label={copy("观影小组导航", "Film Fam navigation")}>
        <button className={!activeChannelId && !notificationsOpen ? "active" : ""} onClick={() => { onNavigate(null); setMobileOpen(false); }} title={copy("我的排片", "My schedule")} type="button"><span>我</span></button>
        {channels.map((channel) => <button className={activeChannelId === channel.id ? "active" : ""} key={channel.id} onClick={() => { onNavigate(channel.id); setMobileOpen(false); }} title={channel.name} type="button"><span style={{ background: avatarColor(channel.name) }}>{channel.name[0]?.toUpperCase()}</span></button>)}
        {user && <button onClick={() => createDialogRef.current?.showModal()} title={copy("新建观影小组", "Create a Film Fam")} type="button">＋</button>}
      </nav>
      <section className="channel-context">
        <div className="channel-heading"><h2>{copy("观影小组", "Film Fams")}</h2>{mobileOpen && <button className="channel-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button>}</div>
        <div className="channel-context-scroll">
          {!user ? <div className="channel-heading-actions"><button onClick={requestChannelCreateDialog} type="button">{copy("登录后创建小组", "Sign in to create a Film Fam")}</button><p>{copy("排片公开浏览；账号只用于想看、分享和小组。", "Schedules stay public; accounts are only for marks, sharing, and Film Fams.")}</p></div> : !selectedChannel ? <div className="channel-group-overview">
            <span className="eyebrow dark">YOUR GROUPS</span>
            <h3>{channels.length ? copy(`${channels.length} 个观影小组`, `${channels.length} Film Fams`) : copy("还没有观影小组", "No Film Fams yet")}</h3>
            <p>{copy("选择一个小组，或通过朋友发来的邀请链接加入。", "Choose a Film Fam or join through a friend’s invitation link.")}</p>
            <div className="channel-overview-list">{channels.map((channel) => <button key={channel.id} onClick={() => onNavigate(channel.id)} type="button"><strong>{channel.name}</strong><small>{channel.owner_user_id === user.id ? copy("组长", "Organizer") : copy("成员", "Member")}</small></button>)}</div>
          </div> : <div className="channel-detail">
            <span className="eyebrow dark">PRIVATE GROUP</span>
            <div className="channel-title-row"><h3>{selectedChannel.name}</h3>{owner && <button className="channel-rename" disabled={busy} onClick={() => void renameSelectedChannel()} type="button">{copy("重命名", "Rename")}</button>}</div>
            <div className="channel-member-list"><b>{copy(`组内成员 · ${members.length}`, `Film Fam members · ${members.length}`)}</b>{members.map((member) => {
              const name = member.profiles?.username ?? copy("成员", "Member");
              return <div className="channel-member-row" key={member.user_id}><span style={{ background: avatarColor(name) }}>{name[0]?.toUpperCase()}</span><strong>@{name}</strong>{member.role === "owner" && <small>{copy("组长", "Organizer")}</small>}{owner && member.role === "member" && <><button disabled={busy} onClick={() => void transferOwnership(member)} type="button">{copy("设为组长", "Make Organizer")}</button><button disabled={busy} onClick={() => void removeMember(member)} type="button">{copy("移除", "Remove")}</button></>}</div>;
            })}</div>
            {owner ? <button className="delete-channel" disabled={busy} onClick={() => void deleteSelectedChannel()} type="button">{copy("删除观影小组", "Delete Film Fam")}</button> : <button className="leave-channel" disabled={busy} onClick={() => void leaveChannel()} type="button">{copy("退出观影小组", "Leave Film Fam")}</button>}
          </div>}
          {message && <p className="channel-message" role="status">{message}</p>}
        </div>
        {user && owner && selectedChannel && <div className="channel-invite-footer"><b>{copy("邀请成员", "Invite members")}</b><button className="copy-invite" disabled={busy} onClick={() => void createLink()} type="button">{copy("复制邀请链接", "Copy invitation link")}</button>{inviteLinks.filter((link) => !link.revoked_at).map((link) => <div className="channel-invite-link" key={link.id}><small>{copy("撤销前一直有效", "Valid until revoked")}</small><button disabled={busy} onClick={() => void revokeLink(link.id)} type="button">{copy("撤销", "Revoke")}</button></div>)}{inviteNotice && <p className="invite-copy-notice" role="status">{inviteNotice}</p>}</div>}
        {user && <div className="channel-user-footer"><strong>@{username ?? "user"}</strong></div>}
      </section>
    </aside>

    <dialog className="channel-create-dialog" ref={createDialogRef}>
      <form className="dialog-close" method="dialog"><button aria-label={copy("关闭", "Close")} type="submit">×</button></form>
      <span className="eyebrow dark">NEW PRIVATE GROUP</span><h2>{copy("创建观影小组", "Create a Film Fam")}</h2>
      <p>{copy("小组只能通过可撤销邀请链接加入；首页想看默认保持私人。", "People join through a revocable invitation link; marks on the main schedule stay private by default.")}</p>
      <form className="channel-create-modal-form" onSubmit={createChannel}><label>{copy("观影小组名称", "Film Fam name")}<input autoFocus maxLength={80} name="name" required /></label>{createMessage && <p className="channel-create-message">{createMessage}</p>}<button disabled={busy} type="submit">{copy("创建观影小组", "Create a Film Fam")}</button></form>
    </dialog>

    <dialog className="auth-dialog invite-dialog" ref={inviteDialogRef}>
      <form className="dialog-close" method="dialog"><button aria-label={copy("关闭", "Close")} type="submit">×</button></form>
      <h2>{invitePreview ? copy(`加入「${invitePreview.channelName}」`, `Join “${invitePreview.channelName}”`) : copy("邀请已失效", "Invitation unavailable")}</h2>
      {invitePreview && <><p className="privacy-note">{copy(`这是一个私人观影小组，目前有 ${invitePreview.memberCount} 名成员。加入后可以看到成员明确分享的想看场次。`, `This is a private Film Fam with ${invitePreview.memberCount} members. After joining, you can see showtimes members explicitly share.`)}</p><button className="auth-submit" disabled={busy} onClick={() => void acceptLink()} type="button">{user ? copy("确认加入", "Confirm and join") : copy("登录或创建账号后加入", "Sign in or create an account to join")}</button></>}
    </dialog>
  </>;
}
