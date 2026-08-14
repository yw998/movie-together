import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeUsername, usernameError } from "../lib/username";
import { passwordChangeError } from "../lib/password";
import { authConfigured, supabase } from "./supabase";
import { useAuth } from "./AuthContext";
import { OPEN_ACCOUNT_EVENT, OPEN_CHANNEL_CREATE_EVENT } from "./account-events";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useChannelIdentity } from "../channels/ChannelIdentityContext";
import { notifyChannelsChanged } from "../channels/channel-api";

type Mode = "login" | "signup" | "resend" | "reset" | "update_password" | "change_password"
  | "channel_login" | "channel_create" | "channel_identity" | "channel_merge";
type AccountControlProps = {
  lightBackground?: boolean;
  notificationRefreshKey?: number;
  notificationsOpen?: boolean;
  onOpenNotifications?: () => void;
};

const IDENTITY_UPGRADE_PENDING_KEY = "movie-together:identity-upgrade-pending";

export function AccountControl({ lightBackground = false, notificationRefreshKey = 0, notificationsOpen = false, onOpenNotifications }: AccountControlProps) {
  const client = supabase;
  const { loading, user, username } = useAuth();
  const channelIdentity = useChannelIdentity();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const upgradeMergeRef = useRef(false);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const [reminderCount, setReminderCount] = useState(0);
  const [identityUpgradePending, setIdentityUpgradePending] = useState(
    () => localStorage.getItem(IDENTITY_UPGRADE_PENDING_KEY) === "true",
  );

  useEffect(() => {
    if (!user || !channelIdentity.identity || !identityUpgradePending || upgradeMergeRef.current) return;
    upgradeMergeRef.current = true;
    setBusy(true);
    void channelIdentity.mergeIntoAccount().then((channelId) => {
      setBusy(false);
      upgradeMergeRef.current = false;
      if (!channelId) {
        setMessage("账号已登录，但小组身份连接失败。你的原凭证仍然有效，请重试。");
        return;
      }
      localStorage.removeItem(IDENTITY_UPGRADE_PENDING_KEY);
      setIdentityUpgradePending(false);
      notifyChannelsChanged();
      setMessage("已升级为个人账号，并保留原有观影小组、角色和想看。");
    });
  }, [channelIdentity, identityUpgradePending, user]);

  useEffect(() => {
    if (!client || !user) {
      setReminderCount(0);
      return;
    }
    const loadReminderCount = async () => {
      const [invitationResult, notificationResult] = await Promise.all([
        client.rpc("list_my_channel_invitations"),
        client.rpc("list_my_channel_notifications"),
      ]);
      if (invitationResult.error || notificationResult.error) return;
      const newMarkCount = (notificationResult.data ?? []).filter((row: { is_new: boolean }) => row.is_new).length;
      setReminderCount((invitationResult.data?.length ?? 0) + newMarkCount);
    };
    void loadReminderCount();
    const timer = window.setInterval(() => void loadReminderCount(), 60_000);
    const refreshOnFocus = () => void loadReminderCount();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [client, notificationRefreshKey, user]);

  useEffect(() => {
    if (!client) return;
    const openForLogin = () => {
      setMode("login");
      setMessage(null);
      dialogRef.current?.showModal();
    };
    window.addEventListener(OPEN_ACCOUNT_EVENT, openForLogin);
    const openForChannelCreate = () => {
      setMode("channel_create");
      setMessage(null);
      dialogRef.current?.showModal();
    };
    window.addEventListener(OPEN_CHANNEL_CREATE_EVENT, openForChannelCreate);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("error_code") === "otp_expired") {
      setMode("resend");
      setMessage("验证链接已失效或已被使用。请输入注册邮箱重新发送；若刚请求过邮件，请等待发送限制解除。");
      dialogRef.current?.showModal();
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("update_password");
        setMessage(null);
        dialogRef.current?.showModal();
      }
    });
    return () => {
      window.removeEventListener(OPEN_ACCOUNT_EVENT, openForLogin);
      window.removeEventListener(OPEN_CHANNEL_CREATE_EVENT, openForChannelCreate);
      listener.subscription.unsubscribe();
    };
  }, [client]);

  if (!authConfigured || !client) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "channel_create") {
      setBusy(true);
      const code = await channelIdentity.createChannel(
        String(form.get("channel_name") ?? "").trim(),
        String(form.get("display_name") ?? "").trim(),
      );
      setBusy(false);
      if (!code) return setMessage("无法创建 Channel；请检查名称后重试。");
      setMode("channel_identity");
      setMessage(`Channel 已创建。请立即保存个人代码：${code}`);
      return;
    }
    if (mode === "channel_login") {
      setBusy(true);
      const channelId = await channelIdentity.login(
        String(form.get("public_channel_id") ?? "").trim(),
        String(form.get("access_code") ?? "").trim(),
      );
      setBusy(false);
      if (!channelId) return setMessage("Channel ID 或个人代码不正确。");
      setMessage(null);
      dialogRef.current?.close();
      return;
    }
    if (mode === "channel_merge") {
      setBusy(true);
      const channelId = await channelIdentity.mergeCredentials(
        String(form.get("public_channel_id") ?? "").trim(),
        String(form.get("access_code") ?? "").trim(),
      );
      setBusy(false);
      if (!channelId) return setMessage("无法连接身份，请检查 Channel ID 和个人代码。");
      await channelIdentity.refresh();
      notifyChannelsChanged();
      setMessage("Channel-only 身份已合并到正式账号。");
      return;
    }
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const currentPassword = String(form.get("current_password") ?? "");
    const passwordConfirmation = String(form.get("password_confirmation") ?? "");
    setMessage(null);
    if (mode === "resend") {
      setBusy(true);
      const { error } = await client!.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      setMessage(
        error
          ? error.status === 429
            ? "发送次数已达限制。7 分钟前的邮件仍有效，请先使用旧邮件，或稍后再试。"
            : "无法重新发送。请确认已用该邮箱注册，或稍后再试。"
          : "验证邮件已重新发送；若未看到，请检查垃圾邮件。",
      );
      setBusy(false);
      return;
    }
    if (mode === "reset") {
      setBusy(true);
      const { error } = await client!.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      setMessage(
        error
          ? "无法发送重设邮件，请稍后重试。"
          : "如果该邮箱已注册，重设密码邮件将很快送达。",
      );
      setBusy(false);
      return;
    }
    if (mode === "change_password") {
      const validation = passwordChangeError(currentPassword, password, passwordConfirmation);
      if (validation) {
        setMessage(validation);
        return;
      }
    } else if (password.length < 8) {
      setMessage("密码至少需要 8 位。请使用不与其他网站重复的密码。");
      return;
    }
    setBusy(true);
    if (mode === "change_password") {
      const { error } = await client!.auth.updateUser({
        password,
        current_password: currentPassword,
      });
      setMessage(
        error
          ? error.code === "weak_password"
            ? "新密码强度不足，请使用更长且不重复的密码。"
            : "修改失败，请确认当前密码正确后重试。"
          : "密码修改成功。",
      );
      if (!error) event.currentTarget.reset();
    } else if (mode === "update_password") {
      const { error } = await client!.auth.updateUser({ password });
      setMessage(error ? "密码更新失败，请重新打开邮件中的链接。" : "密码已更新。");
    } else if (mode === "signup") {
      const requestedUsername = String(form.get("username") ?? "");
      const validation = usernameError(requestedUsername);
      if (validation) {
        setMessage(validation);
        setBusy(false);
        return;
      }
      const { data, error } = await client!.auth.signUp({
        email,
        password,
        options: {
          data: { username: normalizeUsername(requestedUsername) },
          emailRedirectTo: window.location.origin,
        },
      });
      setMessage(
        error
          ? "注册失败。请检查信息，或换一个 username 后重试。"
          : data.session
            ? "账号已创建。"
            : "验证邮件已发送；请验证后登录。",
      );
    } else {
      const { error } = await client!.auth.signInWithPassword({ email, password });
      setMessage(error ? "登录失败，请检查邮箱和密码。" : null);
      if (!error) dialogRef.current?.close();
    }
    setBusy(false);
  }

  async function signOut() {
    setBusy(true);
    await client!.auth.signOut();
    setBusy(false);
  }

  async function rotateIdentityCode() {
    setBusy(true);
    const code = await channelIdentity.rotateCode();
    setBusy(false);
    setMessage(code ? `新代码是 ${code}。旧代码与其他设备会话已失效。` : "无法更换代码。");
  }

  function startIdentityUpgrade() {
    localStorage.setItem(IDENTITY_UPGRADE_PENDING_KEY, "true");
    setIdentityUpgradePending(true);
    setMode("signup");
    setMessage("使用新邮箱注册，或切换到登录并使用已有个人账号；成功后会自动保留当前小组和想看。");
  }

  return (
    <div className={`account-control${lightBackground ? " on-light" : ""}`}>
      {loading || channelIdentity.loading ? null : channelIdentity.identity && !user ? (
        <>
          {onOpenNotifications && <button
            aria-label={channelIdentity.unreadNotificationCount > 0 ? `提醒，${channelIdentity.unreadNotificationCount} 条未读` : "提醒"}
            aria-pressed={notificationsOpen}
            className={`account-reminders${notificationsOpen ? " active" : ""}`}
            onClick={onOpenNotifications}
            title="提醒"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            {channelIdentity.unreadNotificationCount > 0 && <b>{channelIdentity.unreadNotificationCount > 99 ? "99+" : channelIdentity.unreadNotificationCount}</b>}
          </button>}
          <span>{channelIdentity.identity.displayName} <small>GUEST</small></span>
          <button onClick={() => { setMode("channel_identity"); setMessage(null); dialogRef.current?.showModal(); }} type="button">身份</button>
          <button disabled={busy} onClick={() => void channelIdentity.logout()} type="button">退出</button>
        </>
      ) : user ? (
        <>
          {onOpenNotifications && <button
            aria-label={reminderCount > 0 ? `提醒，${reminderCount} 条未读` : "提醒"}
            aria-pressed={notificationsOpen}
            className={`account-reminders${notificationsOpen ? " active" : ""}`}
            onClick={onOpenNotifications}
            title="提醒"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            {reminderCount > 0 && <b>{reminderCount > 99 ? "99+" : reminderCount}</b>}
          </button>}
          <span>@{username ?? "account"}</span>
          <button onClick={() => { setMode("change_password"); setMessage(null); dialogRef.current?.showModal(); }} type="button">修改密码</button>
          <button onClick={() => { setMode("channel_merge"); setMessage(null); dialogRef.current?.showModal(); }} type="button">连接 Channel 身份</button>
          <button disabled={busy} onClick={signOut} type="button">退出</button>
        </>
      ) : (
        <>
          <button onClick={() => { setMode("channel_login"); setMessage(null); dialogRef.current?.showModal(); }} type="button">Channel 登录</button>
          <button onClick={() => { setMode("login"); setMessage(null); dialogRef.current?.showModal(); }} type="button">登录 / 注册</button>
        </>
      )}
      <dialog className="auth-dialog" ref={dialogRef}>
        <form method="dialog" className="dialog-close"><button aria-label="关闭" type="submit">×</button></form>
        {mode !== "change_password" && mode !== "channel_identity" && mode !== "channel_merge" && <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(null); }} type="button">登录</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setMessage(null); }} type="button">注册</button>
          <button className={mode === "channel_login" ? "active" : ""} onClick={() => { setMode("channel_login"); setMessage(null); }} type="button">Channel</button>
        </div>}
        <h2>{mode === "login" ? "欢迎回来" : mode === "signup" ? "创建账号" : mode === "resend" ? "重发验证邮件" : mode === "reset" ? "找回账号" : mode === "change_password" ? "修改密码" : mode === "channel_login" ? "进入 Channel" : mode === "channel_create" ? "创建 Channel" : mode === "channel_identity" ? "Channel 身份" : mode === "channel_merge" ? "连接 Channel-only 身份" : "设置新密码"}</h2>
        {mode === "channel_identity" ? <div className="channel-identity-details">
          <p className="privacy-note">这个身份只能访问下面的 Channel。代码丢失后无法恢复。</p>
          <label>Channel ID<code>{channelIdentity.identity?.publicChannelId}</code></label>
          <label>个人代码<code>{channelIdentity.savedCode ?? "此设备没有保存代码"}</code></label>
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" disabled={busy} onClick={() => void rotateIdentityCode()} type="button">更换个人代码</button>
          <button className="auth-link" onClick={startIdentityUpgrade} type="button">升级为个人账号</button>
        </div> : <>
        <p className="privacy-note">{mode.startsWith("channel_") ? "Channel-only 身份不需要邮箱，只能访问一个 Channel。" : "其他用户只会看到 username。邮箱仅用于登录、验证和找回，不会公开。"}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === "channel_create" && <>
            <label>Channel 名称<input maxLength={80} name="channel_name" required /></label>
            <label>不可修改的显示名<input maxLength={40} name="display_name" required /></label>
          </>}
          {(mode === "channel_login" || mode === "channel_merge") && <>
            <label>Channel ID<input autoCapitalize="characters" name="public_channel_id" pattern="CH-[A-HJ-NP-Za-hj-np-z2-9]{8}" placeholder="CH-7KDM4QPX" required /></label>
            <label>个人代码<input autoCapitalize="characters" name="access_code" pattern="[A-HJ-NP-Za-hj-np-z2-9]{4}-?[A-HJ-NP-Za-hj-np-z2-9]{4}" placeholder="7KDM-4QPX" required /></label>
          </>}
          {mode === "signup" && (
            <label>Username<input autoComplete="username" maxLength={24} minLength={3} name="username" pattern="[a-zA-Z0-9_]+" required /></label>
          )}
          {!mode.startsWith("channel_") && mode !== "update_password" && mode !== "change_password" && <label>邮箱<input autoComplete="email" name="email" required type="email" /></label>}
          {mode === "change_password" ? <>
            <label>当前密码<input autoComplete="current-password" name="current_password" required type="password" /></label>
            <label>新密码<input autoComplete="new-password" minLength={8} name="password" required type="password" /></label>
            <label>确认新密码<input autoComplete="new-password" minLength={8} name="password_confirmation" required type="password" /></label>
          </> : !mode.startsWith("channel_") && mode !== "reset" && mode !== "resend" && <label>密码<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} name="password" required type="password" /></label>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" disabled={busy} type="submit">{busy ? "请稍候…" : mode === "login" ? "登录" : mode === "signup" ? "创建账号" : mode === "resend" ? "重新发送" : mode === "reset" ? "发送重设邮件" : mode === "change_password" ? "保存新密码" : mode === "channel_login" ? "进入 Channel" : mode === "channel_create" ? "创建并获取代码" : mode === "channel_merge" ? "确认连接并合并" : "更新密码"}</button>
          {mode === "channel_login" && <button className="auth-link" onClick={() => { setMode("channel_create"); setMessage(null); }} type="button">没有 Channel？直接创建</button>}
          {mode === "channel_create" && <button className="auth-link" onClick={() => { setMode("channel_login"); setMessage(null); }} type="button">已有 Channel ID 和代码</button>}
          {mode === "login" && <button className="auth-link" onClick={() => { setMode("reset"); setMessage(null); }} type="button">忘记密码？</button>}
          {mode === "signup" && <button className="auth-link" onClick={() => { setMode("resend"); setMessage(null); }} type="button">没有收到验证邮件？</button>}
          {(mode === "resend" || mode === "reset" || mode === "update_password") && <button className="auth-link" onClick={() => { setMode("login"); setMessage(null); }} type="button">返回登录</button>}
          {mode === "change_password" && <button className="auth-link" onClick={() => dialogRef.current?.close()} type="button">取消</button>}
        </form>
        </>}
      </dialog>
    </div>
  );
}
