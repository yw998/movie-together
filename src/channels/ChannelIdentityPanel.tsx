import { useState } from "react";
import { useChannelIdentity } from "./ChannelIdentityContext";
import { avatarColor } from "./avatar";
import { useTransientMessage } from "../lib/useTransientMessage";
import { requestChannelCreateDialog } from "../auth/account-events";

type ChannelIdentityPanelProps = {
  activeChannelId: string | null;
  notificationsOpen: boolean;
  onNavigate: (channelId: string | null) => void;
};

export function ChannelIdentityPanel({ activeChannelId, onNavigate }: ChannelIdentityPanelProps) {
  const channelIdentity = useChannelIdentity();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const identity = channelIdentity.identity;
  if (!identity) return null;
  const activeIdentity = identity;

  async function copyInvite() {
    setBusy(true);
    const url = await channelIdentity.createInviteLink();
    setBusy(false);
    if (!url) return setMessage("无法创建邀请链接。");
    try {
      await navigator.clipboard.writeText(url);
      setMessage("邀请链接已复制：7 天有效，最多 20 人加入。");
    } catch {
      setMessage(`邀请链接：${url}`);
    }
  }

  async function leaveOrDelete() {
    const owner = activeIdentity.role === "owner";
    const confirmed = window.confirm(owner
      ? `确定删除「${activeIdentity.channelName}」吗？全部成员和标记都会永久删除。`
      : `确定退出「${activeIdentity.channelName}」吗？你的身份和标记都会永久删除。`);
    if (!confirmed) return;
    setBusy(true);
    const ok = owner ? await channelIdentity.deleteChannel() : await channelIdentity.leave();
    setBusy(false);
    if (!ok) setMessage(owner ? "无法删除 Channel。" : "无法退出 Channel。");
  }

  async function createAnotherChannel() {
    const confirmed = window.confirm("一个 Channel-only 身份只能属于一个 Channel。继续会退出当前身份，再创建一组独立的 Channel 和个人代码。请确认已经保存当前凭证。");
    if (!confirmed) return;
    await channelIdentity.logout();
    onNavigate(null);
    requestChannelCreateDialog();
  }

  const channelSelected = activeChannelId === identity.channelId;

  return <>
    <button aria-expanded={mobileOpen} className="channel-mobile-toggle" onClick={() => setMobileOpen(true)} type="button">☰ 一起看</button>
    <button aria-label="关闭 Channel" className={`channel-backdrop${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} type="button" />
    <aside className={`channel-panel${channelSelected ? " context-open" : ""}${mobileOpen ? " open" : ""}`}>
      <nav className="channel-rail-nav" aria-label="Channel-only 导航">
        <button aria-label="个人主页" className={`channel-rail-home${!channelSelected ? " active" : ""}`} onClick={() => { onNavigate(null); setMobileOpen(false); }} title="个人主页" type="button">我</button>
        <span className="channel-rail-divider" />
        <div className="channel-rail-list">
          <button aria-label={identity.channelName} className={channelSelected ? "active" : ""} onClick={() => { onNavigate(identity.channelId); setMobileOpen(false); }} title={identity.channelName} type="button">{identity.channelName.trim().slice(0, 2)}</button>
        </div>
        <button aria-label="新建 Channel" className="channel-rail-create" onClick={() => void createAnotherChannel()} title="新建 Channel" type="button">＋</button>
      </nav>
      <section className="channel-context">
        <div className="channel-heading"><h2>一起看</h2><button className="channel-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button></div>
        <div className="channel-context-scroll">
          <div className="channel-detail">
            <span className="eyebrow dark">CHANNEL-ONLY</span>
            <h3>{identity.channelName}</h3>
            <p><code>{identity.publicChannelId}</code> · {identity.role === "owner" ? "OWNER" : "MEMBER"}</p>
            <div className="channel-member-list">
              <b>组内成员 · {channelIdentity.members.length}</b>
              {channelIdentity.members.map((member) => <div className="channel-member-row" key={member.id}>
                <span style={{ background: avatarColor(member.displayName) }}>{member.displayName[0]?.toUpperCase()}</span>
                <strong>{member.kind === "account" ? `@${member.displayName}` : member.displayName}</strong>
                {member.kind === "channel_only" && <small>GUEST</small>}
                {identity.role === "owner" && member.kind === "channel_only" && member.role === "member" && <button
                  aria-label={`移除 ${member.displayName}`}
                  disabled={busy}
                  onClick={() => void channelIdentity.removeMember(member.id.replace("identity:", "")).then((ok) => {
                    if (!ok) setMessage("无法移除成员。");
                  })}
                  type="button"
                >移除</button>}
              </div>)}
            </div>
            {message && <p className="channel-message" role="status">{message}</p>}
            <button className={identity.role === "owner" ? "delete-channel" : "leave-channel"} disabled={busy} onClick={() => void leaveOrDelete()} type="button">
              {identity.role === "owner" ? "删除 Channel" : "退出 Channel"}
            </button>
          </div>
        </div>
        {identity.role === "owner" && <div className="channel-invite-footer">
          <b>邀请成员</b>
          <p>Channel-only owner 只能使用邀请链接。</p>
          <button className="copy-invite" disabled={busy} onClick={() => void copyInvite()} type="button">复制邀请链接</button>
          {channelIdentity.inviteLinks.filter((link) => !link.revokedAt).map((link) => <div className="identity-invite-link" key={link.id}>
            <small>{link.useCount}/{link.maxUses} 次 · {new Date(link.expiresAt).toLocaleDateString("zh-CN")}</small>
            <button disabled={busy} onClick={() => void channelIdentity.revokeInviteLink(link.id).then((ok) => {
              if (!ok) setMessage("无法撤销邀请链接。");
            })} type="button">撤销</button>
          </div>)}
        </div>}
        <div className="channel-user-footer"><strong>{identity.displayName} · GUEST</strong></div>
      </section>
    </aside>
  </>;
}
