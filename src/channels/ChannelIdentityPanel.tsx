import { useState } from "react";
import { useChannelIdentity } from "./ChannelIdentityContext";
import { avatarColor } from "./avatar";
import { useTransientMessage } from "../lib/useTransientMessage";
import { requestAccountDialog } from "../auth/account-events";
import { useI18n } from "../i18n/I18nContext";

type ChannelIdentityPanelProps = {
  activeChannelId: string | null;
  notificationsOpen: boolean;
  onNavigate: (channelId: string | null) => void;
};

export function ChannelIdentityPanel({ activeChannelId, onNavigate }: ChannelIdentityPanelProps) {
  const channelIdentity = useChannelIdentity();
  const { locale, t } = useI18n();
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
    if (!url) return setMessage(t("identity.inviteCreateError"));
    try {
      await navigator.clipboard.writeText(url);
      setMessage(t("identity.inviteCopied"));
    } catch {
      setMessage(t("identity.inviteUrl", { url }));
    }
  }

  async function leaveOrDelete() {
    const owner = activeIdentity.role === "owner";
    const confirmed = window.confirm(owner
      ? t("identity.deleteConfirm", { name: activeIdentity.channelName })
      : t("identity.leaveConfirm", { name: activeIdentity.channelName }));
    if (!confirmed) return;
    setBusy(true);
    const ok = owner ? await channelIdentity.deleteChannel() : await channelIdentity.leave();
    setBusy(false);
    if (!ok) setMessage(owner ? t("identity.deleteError") : t("identity.leaveError"));
  }

  async function renameChannel() {
    const name = window.prompt(t("identity.newName"), activeIdentity.channelName)?.trim();
    if (!name || name === activeIdentity.channelName) return;
    setBusy(true);
    const ok = await channelIdentity.renameChannel(name);
    setBusy(false);
    setMessage(ok ? t("identity.renameSuccess") : t("identity.renameError"));
  }

  async function transferOwnership(memberId: string, kind: "account" | "channel_only", displayName: string) {
    if (!window.confirm(t("identity.transferConfirm", { name: displayName }))) return;
    setBusy(true);
    const ok = await channelIdentity.transferOwnership(kind, memberId.replace(/^(?:user|identity):/, ""));
    setBusy(false);
    setMessage(ok ? t("identity.transferSuccess", { name: displayName }) : t("identity.transferError"));
  }

  const channelSelected = activeChannelId === identity.channelId;

  return <>
    <button aria-expanded={mobileOpen} className="channel-mobile-toggle" onClick={() => setMobileOpen(true)} type="button">{t("identity.mobileToggle")}</button>
    <button aria-label={t("identity.close")} className={`channel-backdrop${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} type="button" />
    <aside className={`channel-panel${channelSelected ? " context-open" : ""}${mobileOpen ? " open" : ""}`}>
      <nav className="channel-rail-nav" aria-label={t("identity.navigation")}>
        <button aria-label={t("identity.back")} className={`channel-rail-home${!channelSelected ? " active" : ""}`} onClick={() => { onNavigate(null); setMobileOpen(false); }} title={t("identity.back")} type="button">{t("identity.me")}</button>
        <span className="channel-rail-divider" />
        <div className="channel-rail-list">
          <button aria-label={identity.channelName} className={channelSelected ? "active" : ""} onClick={() => { onNavigate(identity.channelId); setMobileOpen(false); }} title={identity.channelName} type="button">{identity.channelName.trim().slice(0, 2)}</button>
        </div>
      </nav>
      <section className="channel-context">
        <div className="channel-heading"><h2>{t("nav.filmFams")}</h2>{mobileOpen && <button aria-label={t("identity.close")} className="channel-mobile-close" onClick={() => setMobileOpen(false)} type="button">×</button>}</div>
        <div className="channel-context-scroll">
          <div className="channel-detail">
            <span className="eyebrow dark">GROUP IDENTITY</span>
            <div className="channel-title-row">
              <h3>{identity.channelName}</h3>
              {identity.role === "owner" && <button className="channel-rename" disabled={busy} onClick={() => void renameChannel()} type="button">{t("identity.rename")}</button>}
            </div>
            <p>{t("identity.idRole", { id: identity.publicChannelId, role: identity.role === "owner" ? t("identity.organizer") : t("identity.member") })}</p>
            <div className="channel-member-list">
              <b>{t("identity.members", { count: channelIdentity.members.length })}</b>
              {channelIdentity.members.map((member) => <div className="channel-member-row" key={member.id}>
                <span style={{ background: avatarColor(member.displayName) }}>{member.displayName[0]?.toUpperCase()}</span>
                <strong>{member.kind === "account" ? `@${member.displayName}` : member.displayName}</strong>
                {member.kind === "channel_only" && <small>{t("identity.profile")}</small>}
                {member.role === "owner" && <small>{t("identity.organizer")}</small>}
                {identity.role === "owner" && member.role === "member" && <>
                <button
                  aria-label={t("identity.transferLabel", { name: member.displayName })}
                  disabled={busy}
                  onClick={() => void transferOwnership(member.id, member.kind, member.displayName)}
                  type="button"
                >{t("identity.makeOrganizer")}</button>
                <button
                  aria-label={t("identity.removeLabel", { name: member.displayName })}
                  disabled={busy}
                  onClick={() => void channelIdentity.removeMember(member.kind, member.id.replace(/^(?:user|identity):/, "")).then((ok) => {
                    if (!ok) setMessage(t("identity.removeError"));
                  })}
                  type="button"
                >{t("identity.remove")}</button></>}
              </div>)}
            </div>
            {message && <p className="channel-message" role="status">{message}</p>}
            {identity.role === "owner" && <button className="auth-link" onClick={requestAccountDialog} type="button">{t("identity.upgradeBeforeDelete")}</button>}
            <button className={identity.role === "owner" ? "delete-channel" : "leave-channel"} disabled={busy} onClick={() => void leaveOrDelete()} type="button">
              {identity.role === "owner" ? t("identity.delete") : t("identity.leave")}
            </button>
          </div>
        </div>
        {identity.role === "owner" && <div className="channel-invite-footer">
          <b>{t("identity.inviteMembers")}</b>
          <p>{t("identity.inviteCopy")}</p>
          <button className="copy-invite" disabled={busy} onClick={() => void copyInvite()} type="button">{t("identity.copyInvite")}</button>
          {channelIdentity.inviteLinks.filter((link) => !link.revokedAt).map((link) => <div className="identity-invite-link" key={link.id}>
            <small>{t("identity.inviteUsage", { used: link.useCount, max: link.maxUses, date: new Date(link.expiresAt).toLocaleDateString(locale) })}</small>
            <button disabled={busy} onClick={() => void channelIdentity.revokeInviteLink(link.id).then((ok) => {
              if (!ok) setMessage(t("identity.revokeError"));
            })} type="button">{t("identity.revoke")}</button>
          </div>)}
        </div>}
        <div className="channel-user-footer"><strong>{identity.displayName} · {t("identity.profile")}</strong></div>
      </section>
    </aside>
  </>;
}
