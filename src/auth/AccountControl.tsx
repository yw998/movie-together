import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeUsername, usernameError } from "../lib/username";
import { passwordChangeError } from "../lib/password";
import { authConfigured, supabase } from "./supabase";
import { useAuth } from "./AuthContext";
import { OPEN_ACCOUNT_EVENT } from "./account-events";
import { useTransientMessage } from "../lib/useTransientMessage";

type Mode = "login" | "signup" | "resend" | "reset" | "update_password" | "change_password";
type AccountControlProps = {
  lightBackground?: boolean;
  notificationRefreshKey?: number;
  notificationsOpen?: boolean;
  onOpenNotifications?: () => void;
};

export function AccountControl({ lightBackground = false, notificationRefreshKey = 0, notificationsOpen = false, onOpenNotifications }: AccountControlProps) {
  const client = supabase;
  const { loading, user, username } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const [reminderCount, setReminderCount] = useState(0);

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
      listener.subscription.unsubscribe();
    };
  }, [client]);

  if (!authConfigured || !client) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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

  return (
    <div className={`account-control${lightBackground ? " on-light" : ""}`}>
      {loading ? null : user ? (
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
          <button disabled={busy} onClick={signOut} type="button">退出</button>
        </>
      ) : (
        <button onClick={() => dialogRef.current?.showModal()} type="button">登录 / 注册</button>
      )}
      <dialog className="auth-dialog" ref={dialogRef}>
        <form method="dialog" className="dialog-close"><button aria-label="关闭" type="submit">×</button></form>
        {mode !== "change_password" && <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(null); }} type="button">登录</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setMessage(null); }} type="button">注册</button>
        </div>}
        <h2>{mode === "login" ? "欢迎回来" : mode === "signup" ? "创建账号" : mode === "resend" ? "重发验证邮件" : mode === "reset" ? "找回账号" : mode === "change_password" ? "修改密码" : "设置新密码"}</h2>
        <p className="privacy-note">其他用户只会看到 username。邮箱仅用于登录、验证和找回，不会公开。</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label>Username<input autoComplete="username" maxLength={24} minLength={3} name="username" pattern="[a-zA-Z0-9_]+" required /></label>
          )}
          {mode !== "update_password" && mode !== "change_password" && <label>邮箱<input autoComplete="email" name="email" required type="email" /></label>}
          {mode === "change_password" ? <>
            <label>当前密码<input autoComplete="current-password" name="current_password" required type="password" /></label>
            <label>新密码<input autoComplete="new-password" minLength={8} name="password" required type="password" /></label>
            <label>确认新密码<input autoComplete="new-password" minLength={8} name="password_confirmation" required type="password" /></label>
          </> : mode !== "reset" && mode !== "resend" && <label>密码<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} name="password" required type="password" /></label>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" disabled={busy} type="submit">{busy ? "请稍候…" : mode === "login" ? "登录" : mode === "signup" ? "创建账号" : mode === "resend" ? "重新发送" : mode === "reset" ? "发送重设邮件" : mode === "change_password" ? "保存新密码" : "更新密码"}</button>
          {mode === "login" && <button className="auth-link" onClick={() => { setMode("reset"); setMessage(null); }} type="button">忘记密码？</button>}
          {mode === "signup" && <button className="auth-link" onClick={() => { setMode("resend"); setMessage(null); }} type="button">没有收到验证邮件？</button>}
          {(mode === "resend" || mode === "reset" || mode === "update_password") && <button className="auth-link" onClick={() => { setMode("login"); setMessage(null); }} type="button">返回登录</button>}
          {mode === "change_password" && <button className="auth-link" onClick={() => dialogRef.current?.close()} type="button">取消</button>}
        </form>
      </dialog>
    </div>
  );
}
