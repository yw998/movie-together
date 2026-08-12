import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { supabase } from "../auth/supabase";
import { useAuth } from "../auth/AuthContext";
import { useTransientMessage } from "../lib/useTransientMessage";

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
  const [channels, setChannels] = useState<ShareChannel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useTransientMessage();

  useEffect(() => {
    const client = supabase;
    if (!client || !user) {
      setMessage("请重新登录后设置分享。");
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
        setMessage("无法读取 Channel 分享设置。");
        setBusy(false);
        return;
      }
      const memberships = memberResult.data ?? [];
      const { data: channelRows, error } = memberships.length
        ? await client.from("channels").select("id,name").in("id", memberships.map((row) => row.channel_id))
        : { data: [], error: null };
      if (!active) return;
      if (error) setMessage("无法读取 Channel 分享设置。");
      const defaults = new Map(memberships.map((row) => [row.channel_id, row.auto_share_new_marks]));
      setChannels((channelRows ?? []).map((channel) => ({
        ...channel,
        autoShare: defaults.get(channel.id) ?? false,
      })));
      setSelected(new Set((shareResult.data ?? []).map((share) => share.channel_id)));
      setBusy(false);
    });
    return () => { active = false; };
  }, [markId, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const channelIds = [...selected];
    const saved = await onSaved(channelIds);
    setBusy(false);
    if (saved) onClose();
    else setMessage("无法保存分享设置，请稍后重试。");
  }

  return <aside
    aria-label="选择要分享的 Channel"
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
    <h2>分享到 Channel？</h2>
    <p className="privacy-note">「{filmTitle}」已经加入个人主视图。关闭这里不会取消标记。</p>
    <form className="share-channel-form" onSubmit={submit}>
      {busy && channels.length === 0 ? <p>读取 Channel…</p> : channels.length === 0 ? <p>你还没有加入任何 Channel，此标记仅自己可见。</p> : channels.map((channel) => <label key={channel.id}>
        <input
          checked={selected.has(channel.id)}
          onChange={(event) => setSelected((current) => {
            const next = new Set(current);
            if (event.target.checked) next.add(channel.id); else next.delete(channel.id);
            return next;
          })}
          type="checkbox"
        />
        <span>#{channel.name}{channel.autoShare && <small>默认同步</small>}</span>
      </label>)}
      {message && <p className="auth-message">{message}</p>}
      <button className="auth-submit" disabled={busy} type="submit">{busy ? "保存中…" : "保存分享设置"}</button>
    </form>
  </aside>;
}
