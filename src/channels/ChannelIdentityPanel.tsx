import { useState } from "react";
import { useChannelIdentity } from "./ChannelIdentityContext";
import { avatarColor } from "./avatar";
import { useTransientMessage } from "../lib/useTransientMessage";
import { requestAccountDialog } from "../auth/account-events";

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
    if (!ok) setMessage(owner ? "无法删除观影小组。" : "无法退出观影小组。");
  }

  async function renameChannel() {
    const name = window.prompt("新的观影小组名称", activeIdentity.channelName)?.trim();
    if (!name || name === activeIdentity.channelName) return;
    setBusy(true);
    const ok = await channelIdentity.renameChannel(name);
    setBusy(false);
    setMessage(ok ? "观影小组名称已更新。" : "无法重命名观影小组。");
  }

  async function transferOwnership(memberId: string, kind: "account" | "channel_only", displayName: string) {
    if (!window.confirm(`确定将组长身份转让给「${displayName}」吗？转让后你会成为普通成员。`)) return;
    setBusy(true);
    const ok = await channelIdentity.transferOwnership(kind, memberId.replace(/^(?:user|identity):/, ""));
    setBusy(false);
    setMessage(ok ? `已将组长身份转让给「${displayName}」。` : "无法转让组长身份。");
  }

  const channelSelected = activeChannelId === identity.channelId;

  return <>
    <button aria-expanded={mobileOpen} className="channel-mobile-toggle" onClick={() => setMobileOpen(true)} type="button">☰ 观影小组</button>
    <button aria-label="关闭观影小组" className={`channel-backdrop${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} type="button" />
    <aside className={`channel-panel${channelSelected ? " context-open" : ""}${mobileOpen ? " open" : ""}`}>
      <nav className="channel-rail-nav" aria-label="小组身份导航">
        <button aria-label="个人主页" className={`channel-rail-home${!channelSelected ? " active" : ""}`} onClick={() => { onNavigate(null); setMobileOpen(false); }} title="个人主页" type="button">我</button>
        <span className="channel-rail-divider" />
        <div className="channel-rail-list">
          <button aria-label={identity.channelName} className={channelSelected ? "active" : ""} onClick={() => { onNavigate(identity.channelId); setMobileOpen(false); }} title={identity.channelName} type="button">{identity.channelName.trim().slice(0, 2)}</button>
        </div>
      </nav>
      <section className="channel-context">
        <div className="channel-heading"><h2>观影小组</h2>{mobileOpen && <button aria-label="关闭观影小组" className="channel-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button>}</div>
        <div className="channel-context-scroll">
          <div className="channel-detail">
            <span className="eyebrow dark">GROUP IDENTITY</span>
            <div className="channel-title-row">
              <h3>{identity.channelName}</h3>
              {identity.role === "owner" && <button className="channel-rename" disabled={busy} onClick={() => void renameChannel()} type="button">重命名</button>}
            </div>
            <p>小组编号 <code>{identity.publicChannelId}</code> · {identity.role === "owner" ? "组长" : "成员"}</p>
            <div className="channel-member-list">
              <b>组内成员 · {channelIdentity.members.length}</b>
              {channelIdentity.members.map((member) => <div className="channel-member-row" key={member.id}>
                <span style={{ background: avatarColor(member.displayName) }}>{member.displayName[0]?.toUpperCase()}</span>
                <strong>{member.kind === "account" ? `@${member.displayName}` : member.displayName}</strong>
                {member.kind === "channel_only" && <small>小组身份</small>}
                {member.role === "owner" && <small>组长</small>}
                {identity.role === "owner" && member.role === "member" && <>
                <button
                  aria-label={`转让给 ${member.displayName}`}
                  disabled={busy}
                  onClick={() => void transferOwnership(member.id, member.kind, member.displayName)}
                  type="button"
                >设为组长</button>
                <button
                  aria-label={`移除 ${member.displayName}`}
                  disabled={busy}
                  onClick={() => void channelIdentity.removeMember(member.kind, member.id.replace(/^(?:user|identity):/, "")).then((ok) => {
                    if (!ok) setMessage("无法移除成员。");
                  })}
                  type="button"
                >移除</button></>}
              </div>)}
            </div>
            {message && <p className="channel-message" role="status">{message}</p>}
            {identity.role === "owner" && <button className="auth-link" onClick={requestAccountDialog} type="button">删除前先升级为个人账号，保留小组和想看</button>}
            <button className={identity.role === "owner" ? "delete-channel" : "leave-channel"} disabled={busy} onClick={() => void leaveOrDelete()} type="button">
              {identity.role === "owner" ? "删除观影小组" : "退出观影小组"}
            </button>
          </div>
        </div>
        {identity.role === "owner" && <div className="channel-invite-footer">
          <b>邀请成员</b>
          <p>小组身份的组长通过私密链接邀请成员。</p>
          <button className="copy-invite" disabled={busy} onClick={() => void copyInvite()} type="button">复制邀请链接</button>
          {channelIdentity.inviteLinks.filter((link) => !link.revokedAt).map((link) => <div className="identity-invite-link" key={link.id}>
            <small>{link.useCount}/{link.maxUses} 次 · {new Date(link.expiresAt).toLocaleDateString("zh-CN")}</small>
            <button disabled={busy} onClick={() => void channelIdentity.revokeInviteLink(link.id).then((ok) => {
              if (!ok) setMessage("无法撤销邀请链接。");
            })} type="button">撤销</button>
          </div>)}
        </div>}
        <div className="channel-user-footer"><strong>{identity.displayName} · 小组身份</strong></div>
      </section>
    </aside>
  </>;
}
