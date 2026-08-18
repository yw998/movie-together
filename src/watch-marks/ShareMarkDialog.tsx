import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { supabase } from "../auth/supabase";
import { useAuth } from "../auth/AuthContext";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useI18n } from "../i18n/I18nContext";

type ShareChannel = { id: string; name: string; autoShare: boolean };

export function ShareMarkPopover({
  markId,
  filmTitle,
  anchor,
  onClose,
  onSaved,
}: {
  markId: string;
  filmTitle: string;
  anchor: { left: number; top: number; maxHeight: number; placement: "above" | "below" };
  onClose: () => void;
  onSaved: (channelIds: string[]) => Promise<boolean>;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [channels, setChannels] = useState<ShareChannel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useTransientMessage();

  useEffect(() => {
    const client = supabase;
    if (!client || !user) {
      setMessage(t("share.signIn"));
      setBusy(false);
      return;
    }
    let active = true;
    void Promise.all([
      client.from("channel_members").select("channel_id,auto_share_new_marks").eq("user_id", user.id),
      client.from("channel_mark_shares").select("channel_id").eq("mark_id", markId),
    ]).then(async ([memberResult, shareResult]) => {
      if (!active) return;
      if (memberResult.error || shareResult.error) {
        setMessage(t("share.loadError"));
        setBusy(false);
        return;
      }
      const memberships = memberResult.data ?? [];
      const { data: channelRows, error } = memberships.length
        ? await client.from("channels").select("id,name").in("id", memberships.map((row) => row.channel_id))
        : { data: [], error: null };
      if (!active) return;
      if (error) setMessage(t("share.loadError"));
      const defaults = new Map(memberships.map((row) => [row.channel_id, row.auto_share_new_marks]));
      setChannels((channelRows ?? []).map((channel) => ({
        ...channel,
        autoShare: defaults.get(channel.id) ?? false,
      })));
      setSelected(new Set((shareResult.data ?? []).map((share) => share.channel_id)));
      setBusy(false);
    });
    return () => { active = false; };
  }, [markId, t, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const channelIds = [...selected];
    const saved = await onSaved(channelIds);
    setBusy(false);
    if (saved) onClose();
    else setMessage(t("share.saveError"));
  }

  return <aside
    aria-label={t("share.dialogLabel")}
    className={`share-mark-popover ${anchor.placement}`}
    role="dialog"
    style={{
      "--share-left": `${anchor.left}px`,
      "--share-top": `${anchor.top}px`,
      "--share-max-height": `${anchor.maxHeight}px`,
    } as CSSProperties}
  >
    <button className="share-dialog-close" onClick={onClose} type="button">×</button>
    <span className="eyebrow dark">PERSONAL MARK SAVED</span>
    <h2>{t("share.title")}</h2>
    <p className="privacy-note">{t("share.savedCopy", { film: filmTitle })}</p>
    <form className="share-channel-form" onSubmit={submit}>
      {busy && channels.length === 0 ? <p>{t("share.loading")}</p> : channels.length === 0 ? <p>{t("share.noFams")}</p> : channels.map((channel) => <label key={channel.id}>
        <input
          checked={selected.has(channel.id)}
          onChange={(event) => setSelected((current) => {
            const next = new Set(current);
            if (event.target.checked) next.add(channel.id); else next.delete(channel.id);
            return next;
          })}
          type="checkbox"
        />
        <span>#{channel.name}{channel.autoShare && <small>{t("share.default")}</small>}</span>
      </label>)}
      {message && <p className="auth-message">{message}</p>}
      <button className="auth-submit" disabled={busy} type="submit">{busy ? t("showing.saving") : t("share.save")}</button>
    </form>
  </aside>;
}
