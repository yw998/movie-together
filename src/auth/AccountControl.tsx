import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeUsername, usernameError } from "../lib/username";
import { authConfigured, supabase } from "./supabase";
import { useAuth } from "./AuthContext";
import { OPEN_ACCOUNT_EVENT, OPEN_CHANNEL_CREATE_EVENT, requestRegisteredGroupCreate } from "./account-events";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useI18n } from "../i18n/I18nContext";
import { TurnstileWidget, turnstileSiteKey } from "./TurnstileWidget";
import {
  AccountAuthError,
  changeUsernamePassword,
  createUsernameAccount,
  deleteUsernameAccount,
  loginWithUsername,
  recoverUsernameAccount,
  rotateRecoveryCode,
} from "./account-api";

type Mode = "login" | "signup" | "recover" | "recovery_receipt" | "account_summary" | "change_password" | "delete_account";
type AccountControlProps = {
  lightBackground?: boolean;
  notificationRefreshKey?: number;
  notificationsOpen?: boolean;
  onOpenNotifications?: () => void;
};
type AccountSummary = { markedFilmCount: number; groupCount: number };

function accountAge(createdAt: string | undefined, locale: "zh-CN" | "en-US"): string {
  if (!createdAt) return "—";
  const days = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
  if (days === 0) return locale === "zh-CN" ? "今天" : "Today";
  if (days < 30) return locale === "zh-CN" ? `${days} 天` : `${days} days`;
  if (days < 365) return locale === "zh-CN" ? `${Math.floor(days / 30)} 个月` : `${Math.floor(days / 30)} months`;
  return locale === "zh-CN" ? `${Math.floor(days / 365)} 年` : `${Math.floor(days / 365)} years`;
}

function authErrorMessage(error: unknown, copy: (zh: string, en: string) => string): string {
  const code = error instanceof AccountAuthError ? error.code : "unavailable";
  if (code === "captcha_required") return copy("请完成人机验证后重试。", "Complete the bot check, then try again.");
  if (code === "invalid_credentials") return copy("用户名或密码错误。", "The username or password is incorrect.");
  if (code === "username_taken") return copy("这个用户名已被占用或永久保留。", "This username is taken or permanently reserved.");
  if (code === "weak_password") return copy("请使用至少 6 位且不常见的密码。", "Use a password with at least 6 characters that is not commonly used.");
  if (code === "invalid_recovery") return copy("用户名或恢复码不正确。", "The username or recovery code is incorrect.");
  if (code === "rate_limited") return copy("尝试次数过多，请稍后再试。", "Too many attempts. Try again later.");
  if (code === "owned_channels") return copy("请先转让或删除你创建的所有观影小组。", "Transfer or delete every Film Fam you organize first.");
  return copy("服务暂时不可用，请稍后重试。", "The service is temporarily unavailable. Try again later.");
}

export function AccountControl({ lightBackground = false, notificationRefreshKey = 0, notificationsOpen = false, onOpenNotifications }: AccountControlProps) {
  const client = supabase;
  const { loading, user, username } = useAuth();
  const { copy, locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const [reminderCount, setReminderCount] = useState(0);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [accountSummaryError, setAccountSummaryError] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryUsername, setRecoveryUsername] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [createGroupAfterAuth, setCreateGroupAfterAuth] = useState(false);

  useEffect(() => {
    setCaptchaRequired(false);
    setCaptchaToken(null);
    setCaptchaResetKey((current) => current + 1);
  }, [mode]);

  useEffect(() => {
    if (!client || !user) return setReminderCount(0);
    const load = async () => {
      const { data, error } = await client.rpc("list_my_channel_notifications");
      if (!error) setReminderCount((data ?? []).filter((row: { is_new: boolean }) => row.is_new).length);
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    window.addEventListener("focus", load);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [client, notificationRefreshKey, user]);

  useEffect(() => {
    if (!client || !user || mode !== "account_summary") return;
    let active = true;
    setAccountSummary(null);
    setAccountSummaryError(false);
    void client.rpc("get_my_account_summary").then(({ data, error }) => {
      if (!active) return;
      const row = data?.[0] as { marked_film_count?: number; group_count?: number } | undefined;
      if (error || !row) return setAccountSummaryError(true);
      setAccountSummary({ markedFilmCount: Number(row.marked_film_count ?? 0), groupCount: Number(row.group_count ?? 0) });
    });
    return () => { active = false; };
  }, [client, mode, user]);

  useEffect(() => {
    if (!client) return;
    const openAccount = () => {
      setMode(user ? "account_summary" : "login");
      setMessage(null);
      dialogRef.current?.showModal();
    };
    const openCreate = () => {
      if (user) return requestRegisteredGroupCreate();
      setCreateGroupAfterAuth(true);
      setMode("login");
      setMessage(copy("登录或创建账号后继续创建观影小组。", "Sign in or create an account to continue creating a Film Fam."));
      dialogRef.current?.showModal();
    };
    window.addEventListener(OPEN_ACCOUNT_EVENT, openAccount);
    window.addEventListener(OPEN_CHANNEL_CREATE_EVENT, openCreate);
    return () => {
      window.removeEventListener(OPEN_ACCOUNT_EVENT, openAccount);
      window.removeEventListener(OPEN_CHANNEL_CREATE_EVENT, openCreate);
    };
  }, [client, copy, setMessage, user]);

  if (!authConfigured || !client) return null;
  const activeClient = client;

  function resetCaptcha() {
    setCaptchaToken(null);
    setCaptchaResetKey((current) => current + 1);
  }

  function finishAuthentication(nextRecoveryCode?: string | null, nextUsername?: string | null) {
    if (nextRecoveryCode) {
      setRecoveryCode(nextRecoveryCode);
      setRecoveryUsername(nextUsername ?? username);
      setRecoverySaved(false);
      setMode("recovery_receipt");
      return;
    }
    dialogRef.current?.close();
    if (createGroupAfterAuth) {
      setCreateGroupAfterAuth(false);
      window.setTimeout(requestRegisteredGroupCreate, 0);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const requestedUsername = normalizeUsername(String(form.get("username") ?? username ?? ""));
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");
    setMessage(null);

    if (mode === "signup") {
      const validation = usernameError(requestedUsername, locale);
      if (validation) return setMessage(validation);
    }
    if ((mode === "signup" || mode === "recover" || mode === "change_password") && password !== confirmation) {
      return setMessage(copy("两次输入的密码不一致。", "The passwords do not match."));
    }
    if ((mode === "signup" || mode === "recover" || mode === "change_password") && password.length < 6) {
      return setMessage(copy("密码至少需要 6 位。", "The password must contain at least 6 characters."));
    }

    setBusy(true);
    try {
      if (mode === "login") {
        const result = await loginWithUsername(activeClient, requestedUsername, password, captchaToken ?? undefined);
        finishAuthentication(result.recoveryCode, requestedUsername);
      } else if (mode === "signup") {
        const result = await createUsernameAccount(activeClient, requestedUsername, password, captchaToken ?? undefined);
        finishAuthentication(result.recoveryCode, requestedUsername);
      } else if (mode === "recover") {
        const result = await recoverUsernameAccount(activeClient, requestedUsername, String(form.get("recovery_code") ?? ""), password, captchaToken ?? undefined);
        finishAuthentication(result.recoveryCode, requestedUsername);
      } else if (mode === "change_password") {
        if (!username) throw new AccountAuthError("invalid_credentials");
        await changeUsernamePassword(activeClient, String(form.get("current_password") ?? ""), password, captchaToken ?? undefined);
        formElement.reset();
        setMessage(copy("密码已更新，其他设备已退出。", "Password updated. Other devices have been signed out."));
      } else if (mode === "delete_account") {
        if (requestedUsername !== username) throw new AccountAuthError("invalid_credentials");
        await deleteUsernameAccount(activeClient, requestedUsername, password, captchaToken ?? undefined);
        await activeClient.auth.signOut({ scope: "local" });
        dialogRef.current?.close();
      }
    } catch (error) {
      setMessage(authErrorMessage(error, copy));
      if (error instanceof AccountAuthError && error.code === "captcha_required") setCaptchaRequired(true);
      resetCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await activeClient.auth.signOut();
    setBusy(false);
  }

  async function generateNewRecoveryCode() {
    setBusy(true);
    try {
      setRecoveryCode(await rotateRecoveryCode(activeClient));
      setRecoveryUsername(username);
      setRecoverySaved(false);
      setMode("recovery_receipt");
    } catch (error) {
      setMessage(authErrorMessage(error, copy));
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCode() {
    if (!recoveryCode) return;
    await navigator.clipboard.writeText(recoveryCode);
    setMessage(copy("恢复码已复制。", "Recovery code copied."));
  }

  function downloadRecoveryCode() {
    if (!recoveryCode || !recoveryUsername) return;
    const blob = new Blob([`NYC Movie Together\nUsername: ${recoveryUsername}\nRecovery code: ${recoveryCode}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nyc-movie-together-${recoveryUsername}-recovery.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const title = mode === "signup" ? copy("创建账号", "Create account")
    : mode === "recover" ? copy("恢复账号", "Recover account")
      : mode === "recovery_receipt" ? copy("保存恢复码", "Save your recovery code")
        : mode === "account_summary" ? copy("账号", "Account")
          : mode === "change_password" ? copy("修改密码", "Change password")
            : mode === "delete_account" ? copy("删除账号", "Delete account")
              : copy("登录", "Sign in");

  return <div className={`account-control${lightBackground ? " on-light" : ""}`}>
    {loading ? null : user ? <>
      {onOpenNotifications && <button
        aria-label={reminderCount > 0 ? copy(`提醒，${reminderCount} 条未读`, `Notifications, ${reminderCount} unread`) : copy("提醒", "Notifications")}
        aria-pressed={notificationsOpen}
        className={`account-reminders${notificationsOpen ? " active" : ""}`}
        onClick={onOpenNotifications}
        type="button"
      >♢{reminderCount > 0 && <b>{reminderCount > 99 ? "99+" : reminderCount}</b>}</button>}
      <span>@{username ?? "account"}</span>
      <button onClick={() => { setMode("account_summary"); setMessage(null); dialogRef.current?.showModal(); }} type="button">{copy("账号", "Account")}</button>
      <button disabled={busy} onClick={() => void signOut()} type="button">{copy("退出", "Sign out")}</button>
    </> : <button onClick={() => { setMode("login"); setMessage(null); dialogRef.current?.showModal(); }} type="button">{copy("登录 / 注册", "Sign in / Register")}</button>}

    <dialog className="auth-dialog" onCancel={(event) => { if (mode === "recovery_receipt") event.preventDefault(); }} ref={dialogRef}>
      {mode !== "recovery_receipt" && <form method="dialog" className="dialog-close"><button aria-label={copy("关闭", "Close")} type="submit">×</button></form>}
      <h2>{title}</h2>
      {mode === "recovery_receipt" ? <div className="account-summary recovery-receipt">
        <p className="privacy-note">{copy("这是忘记密码后的唯一找回方式。我们无法再次显示旧恢复码，也无法人工恢复账号。", "This is the only way to recover a forgotten password. We cannot show the old code again or recover the account manually.")}</p>
        <code>{recoveryCode}</code>
        {message && <p className="auth-message" role="status">{message}</p>}
        <div className="recovery-actions">
          <button className="auth-submit" onClick={() => void copyRecoveryCode()} type="button">{copy("复制", "Copy")}</button>
          <button className="auth-submit" onClick={downloadRecoveryCode} type="button">{copy("下载", "Download")}</button>
        </div>
        <label><input checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} type="checkbox" />{copy("我已保存恢复码", "I saved the recovery code")}</label>
        <button className="auth-submit" disabled={!recoverySaved} onClick={() => finishAuthentication()} type="button">{copy("继续", "Continue")}</button>
      </div> : mode === "account_summary" ? <div className="account-summary">
        <p className="account-summary-name">@{username ?? "account"}</p>
        <div className="account-summary-grid">
          <article><strong>{accountSummary?.markedFilmCount ?? "—"}</strong><span>{copy("已标记电影", "Marked films")}</span></article>
          <article><strong>{accountSummary?.groupCount ?? "—"}</strong><span>{copy("观影小组", "Film Fams")}</span></article>
          <article><strong>{accountAge(user?.created_at, locale)}</strong><span>{copy("账号时长", "Account age")}</span></article>
        </div>
        {accountSummaryError && <p className="auth-message">{copy("暂时无法读取账号统计。", "Could not load account statistics.")}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="auth-submit" onClick={() => { setMode("change_password"); setMessage(null); }} type="button">{copy("修改密码", "Change password")}</button>
        <button className="auth-submit" disabled={busy} onClick={() => void generateNewRecoveryCode()} type="button">{copy("生成新的恢复码", "Generate a new recovery code")}</button>
        <button className="auth-link delete-account-link" onClick={() => { setMode("delete_account"); setMessage(null); }} type="button">{copy("删除账号", "Delete account")}</button>
      </div> : <>
        <p className="privacy-note">{mode === "signup"
          ? copy("无需邮箱。用户名也是朋友在小组中看到的名字，创建后不可修改。", "No email needed. Your username is also the name friends see, and it cannot be changed.")
          : mode === "recover"
            ? copy("输入创建账号或上次恢复时保存的恢复码。", "Enter the recovery code saved at signup or after the last recovery.")
            : mode === "delete_account"
              ? copy("删除是永久操作。请先转让或删除你创建的观影小组。", "Deletion is permanent. Transfer or delete the Film Fams you organize first.")
              : copy("使用用户名和密码登录。", "Sign in with your username and password.")}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode !== "change_password" && <label>{mode === "delete_account" ? copy("输入用户名确认", "Type your username to confirm") : copy("用户名", "Username")}<input autoCapitalize="none" autoComplete="username" maxLength={24} minLength={3} name="username" pattern="[a-zA-Z0-9_]+" placeholder={mode === "delete_account" ? username ?? "" : undefined} required /></label>}
          {mode === "recover" && <label>{copy("恢复码", "Recovery code")}<input autoCapitalize="characters" autoComplete="off" name="recovery_code" pattern="[A-HJ-NP-Za-hj-np-z2-9]{4}(-[A-HJ-NP-Za-hj-np-z2-9]{4}){3}" placeholder="MAPL-RIVR-83KQ-7X2D" required /></label>}
          {mode === "change_password" && <label>{copy("当前密码", "Current password")}<input autoComplete="current-password" name="current_password" required type="password" /></label>}
          <label>{mode === "change_password" || mode === "recover" ? copy("新密码", "New password") : copy("密码", "Password")}<input autoComplete={mode === "login" || mode === "delete_account" ? "current-password" : "new-password"} minLength={6} name="password" required type="password" /></label>
          {(mode === "signup" || mode === "recover" || mode === "change_password") && <label>{copy("确认密码", "Confirm password")}<input autoComplete="new-password" minLength={6} name="password_confirmation" required type="password" /></label>}
          {message && <p className="auth-message" role="status">{message}</p>}
          {captchaRequired && turnstileSiteKey && <TurnstileWidget onTokenChange={setCaptchaToken} resetKey={captchaResetKey} />}
          <button className={`auth-submit${mode === "delete_account" ? " danger" : ""}`} disabled={busy || (captchaRequired && Boolean(turnstileSiteKey) && !captchaToken)} type="submit">{busy ? copy("处理中…", "Working…") : title}</button>
          {mode === "login" && <>
            <button className="auth-link" onClick={() => { setMode("signup"); setMessage(null); }} type="button">{copy("没有账号？创建账号", "No account? Create one")}</button>
            <button className="auth-link" onClick={() => { setMode("recover"); setMessage(null); }} type="button">{copy("忘记密码？使用恢复码", "Forgot password? Use a recovery code")}</button>
          </>}
          {(mode === "signup" || mode === "recover") && <button className="auth-link" onClick={() => { setMode("login"); setMessage(null); }} type="button">{copy("返回登录", "Back to sign in")}</button>}
          {(mode === "change_password" || mode === "delete_account") && <button className="auth-link" onClick={() => { setMode("account_summary"); setMessage(null); }} type="button">{copy("返回账号", "Back to account")}</button>}
        </form>
      </>}
    </dialog>
  </div>;
}
