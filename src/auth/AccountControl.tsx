import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeUsername, usernameError } from "../lib/username";
import { passwordChangeError } from "../lib/password";
import { authConfigured, supabase } from "./supabase";
import { useAuth } from "./AuthContext";
import { IDENTITY_CREDENTIALS_PENDING_KEY, OPEN_ACCOUNT_EVENT, OPEN_CHANNEL_CREATE_EVENT, requestRegisteredGroupCreate } from "./account-events";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useChannelIdentity } from "../channels/ChannelIdentityContext";
import { notifyChannelsChanged } from "../channels/channel-api";
import { useI18n } from "../i18n/I18nContext";
import { authRedirectUrl } from "./auth-redirect";
import { TurnstileWidget, turnstileSiteKey } from "./TurnstileWidget";

type Mode = "login" | "signup" | "resend" | "reset" | "update_password" | "account_summary" | "change_password"
  | "channel_login" | "channel_create_choice" | "channel_create" | "channel_identity" | "channel_merge";
type AccountControlProps = {
  lightBackground?: boolean;
  notificationRefreshKey?: number;
  notificationsOpen?: boolean;
  onOpenNotifications?: () => void;
  onOpenGroup?: (channelId: string) => void;
};

const IDENTITY_UPGRADE_PENDING_KEY = "movie-together:identity-upgrade-pending";
const RESEND_COOLDOWN_SECONDS = 60;
const CAPTCHA_MODES = new Set<Mode>(["login", "signup", "resend", "reset"]);

type AccountSummary = {
  markedFilmCount: number;
  groupCount: number;
};

function accountAge(createdAt: string | undefined, locale: "zh-CN" | "en-US"): string {
  if (!createdAt) return "—";
  const elapsedDays = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
  if (elapsedDays === 0) return locale === "zh-CN" ? "今天" : "Today";
  if (elapsedDays < 30) return locale === "zh-CN" ? `${elapsedDays} 天` : `${elapsedDays} days`;
  if (elapsedDays < 365) return locale === "zh-CN" ? `${Math.floor(elapsedDays / 30)} 个月` : `${Math.floor(elapsedDays / 30)} months`;
  return locale === "zh-CN" ? `${Math.floor(elapsedDays / 365)} 年` : `${Math.floor(elapsedDays / 365)} years`;
}

export function AccountControl({ lightBackground = false, notificationRefreshKey = 0, notificationsOpen = false, onOpenGroup, onOpenNotifications }: AccountControlProps) {
  const client = supabase;
  const { loading, user, username } = useAuth();
  const { copy, locale } = useI18n();
  const channelIdentity = useChannelIdentity();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const upgradeMergeRef = useRef(false);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const [reminderCount, setReminderCount] = useState(0);
  const [completedGroupId, setCompletedGroupId] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [accountSummaryError, setAccountSummaryError] = useState(false);
  const [identityUpgradePending, setIdentityUpgradePending] = useState(
    () => localStorage.getItem(IDENTITY_UPGRADE_PENDING_KEY) === "true",
  );
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    setCaptchaToken(null);
    setCaptchaResetKey((current) => current + 1);
  }, [mode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!user || !channelIdentity.identity || !identityUpgradePending || upgradeMergeRef.current) return;
    void finishIdentityUpgrade();
  }, [channelIdentity, identityUpgradePending, user]);

  useEffect(() => {
    if (!channelIdentity.identity || localStorage.getItem(IDENTITY_CREDENTIALS_PENDING_KEY) !== "true") return;
    localStorage.removeItem(IDENTITY_CREDENTIALS_PENDING_KEY);
    setMode("channel_identity");
    setMessage(copy("请立即复制并保存小组编号和个人代码。个人代码丢失后无法找回。", "Copy and save the Film Fam ID and personal code now. A lost personal code cannot be recovered."));
    dialogRef.current?.showModal();
  }, [channelIdentity.identity, copy, setMessage]);

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
    if (!client || !user || mode !== "account_summary") return;
    let active = true;
    setAccountSummary(null);
    setAccountSummaryError(false);
    void client.rpc("get_my_account_summary").then(({ data, error }) => {
      if (!active) return;
      const row = data?.[0] as { marked_film_count?: number; group_count?: number } | undefined;
      if (error || !row) {
        setAccountSummaryError(true);
        return;
      }
      setAccountSummary({
        markedFilmCount: Number(row.marked_film_count ?? 0),
        groupCount: Number(row.group_count ?? 0),
      });
    });
    return () => { active = false; };
  }, [client, mode, user]);

  useEffect(() => {
    if (!client) return;
    const openForLogin = () => {
      setCompletedGroupId(null);
      setMode(channelIdentity.identity ? "channel_identity" : user ? "account_summary" : "login");
      setMessage(null);
      dialogRef.current?.showModal();
    };
    window.addEventListener(OPEN_ACCOUNT_EVENT, openForLogin);
    const openForChannelCreate = () => {
      setCompletedGroupId(null);
      if (user) {
        requestRegisteredGroupCreate();
        return;
      }
      setMode(channelIdentity.identity ? "channel_identity" : "channel_create_choice");
      setMessage(null);
      dialogRef.current?.showModal();
    };
    window.addEventListener(OPEN_CHANNEL_CREATE_EVENT, openForChannelCreate);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("error_code") === "otp_expired") {
      setMode("resend");
      setMessage(copy("验证链接已失效或已被使用。请输入注册邮箱重新发送；若刚请求过邮件，请等待发送限制解除。", "The verification link expired or was already used. Enter your registration email to resend it; if you just requested one, wait for the sending limit to reset."));
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
  }, [channelIdentity.identity, client, copy, user]);

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
      if (!code) return setMessage(copy("无法创建观影小组；请检查名称后重试。", "Could not create the Film Fam. Check the name and try again."));
      setMode("channel_identity");
      setMessage(copy(`观影小组已创建。请立即保存个人代码：${code}`, `Film Fam created. Save this personal code now: ${code}`));
      return;
    }
    if (mode === "channel_login") {
      setBusy(true);
      const channelId = await channelIdentity.login(
        String(form.get("public_channel_id") ?? "").trim(),
        String(form.get("access_code") ?? "").trim(),
      );
      setBusy(false);
      if (!channelId) return setMessage(copy("小组编号或个人代码不正确。", "The Film Fam ID or personal code is incorrect."));
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
      if (!channelId) return setMessage(copy("无法连接身份，请检查小组编号和个人代码。", "Could not connect the profile. Check the Film Fam ID and personal code."));
      await channelIdentity.refresh();
      notifyChannelsChanged();
      setCompletedGroupId(channelId);
      setMessage(null);
      return;
    }
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const currentPassword = String(form.get("current_password") ?? "");
    const passwordConfirmation = String(form.get("password_confirmation") ?? "");
    setMessage(null);
    const captchaRequired = Boolean(turnstileSiteKey) && CAPTCHA_MODES.has(mode);
    if (captchaRequired && !captchaToken) {
      setMessage(copy("请先完成人机验证。", "Complete the bot check first."));
      return;
    }
    const redirectUrl = authRedirectUrl();
    const resetCaptcha = () => {
      setCaptchaToken(null);
      setCaptchaResetKey((current) => current + 1);
    };
    if (mode === "resend") {
      if (resendCooldown > 0) {
        setMessage(copy(`请等待 ${resendCooldown} 秒后再试。`, `Try again in ${resendCooldown} seconds.`));
        return;
      }
      setBusy(true);
      const { error } = await client!.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectUrl, captchaToken: captchaToken ?? undefined },
      });
      if (!error || error.status === 429) setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setMessage(
        error
          ? error.status === 429
            ? copy("发送频率已达限制。请使用最近收到的邮件，或等待倒计时结束后再试。", "The sending limit was reached. Use the most recent email, or wait for the countdown before trying again.")
            : copy("无法重新发送。请确认已用该邮箱注册，或稍后再试。", "Could not resend the email. Confirm that this email is registered, or try later.")
          : copy("验证邮件已重新发送；若未看到，请检查垃圾邮件。", "Verification email resent. Check your spam folder if you do not see it."),
      );
      setBusy(false);
      resetCaptcha();
      return;
    }
    if (mode === "reset") {
      setBusy(true);
      const { error } = await client!.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
        captchaToken: captchaToken ?? undefined,
      });
      setMessage(
        error
          ? copy("无法发送重设邮件，请稍后重试。", "Could not send the reset email. Please try again later.")
          : copy("如果该邮箱已注册，重设密码邮件将很快送达。", "If this email is registered, a password-reset message will arrive shortly."),
      );
      setBusy(false);
      resetCaptcha();
      return;
    }
    if (mode === "change_password") {
      const validation = passwordChangeError(currentPassword, password, passwordConfirmation, locale);
      if (validation) {
        setMessage(validation);
        return;
      }
    } else if (password.length < 8) {
      setMessage(copy("密码至少需要 8 位。请使用不与其他网站重复的密码。", "The password must be at least 8 characters. Use one you do not reuse elsewhere."));
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
            ? copy("新密码强度不足，请使用更长且不重复的密码。", "The new password is too weak. Use a longer, unique password.")
            : copy("修改失败，请确认当前密码正确后重试。", "Could not change the password. Confirm your current password and try again.")
          : copy("密码修改成功。", "Password changed."),
      );
      if (!error) event.currentTarget.reset();
    } else if (mode === "update_password") {
      const { error } = await client!.auth.updateUser({ password });
      setMessage(error ? copy("密码更新失败，请重新打开邮件中的链接。", "Password update failed. Open the link in the email again.") : copy("密码已更新。", "Password updated."));
    } else if (mode === "signup") {
      const requestedUsername = String(form.get("username") ?? "");
      const validation = usernameError(requestedUsername, locale);
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
          emailRedirectTo: redirectUrl,
          captchaToken: captchaToken ?? undefined,
        },
      });
      const existingAccount = error?.code === "user_already_exists"
        || error?.code === "email_exists"
        || /already (?:registered|exists)/i.test(error?.message ?? "")
        || (!error && data.user !== null && (data.user.identities?.length ?? 0) === 0);
      if (existingAccount) {
        setLoginEmail(email);
        setMessage(copy("这个邮箱已经注册。请转到个人账号登录；登录成功后会继续连接当前小组身份。", "This email is already registered. Sign in to the personal account; after signing in, the current Film Fam profile will continue connecting."));
        setBusy(false);
        resetCaptcha();
        return;
      }
      setMessage(
        error
          ? copy("注册失败。请检查信息，或换一个 username 后重试。", "Registration failed. Check the information or try a different username.")
          : data.session
            ? copy("账号已创建。", "Account created.")
            : copy("验证邮件已发送；请验证后登录。", "Verification email sent. Verify your email, then sign in."),
      );
    } else {
      const { error } = await client!.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken: captchaToken ?? undefined },
      });
      setMessage(error ? copy("登录失败，请检查邮箱和密码。", "Sign-in failed. Check your email and password.") : null);
      if (!error) dialogRef.current?.close();
    }
    setBusy(false);
    if (CAPTCHA_MODES.has(mode)) resetCaptcha();
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
    setMessage(code ? copy(`新代码是 ${code}。旧代码与其他设备会话已失效。`, `Your new code is ${code}. The old code and sessions on other devices no longer work.`) : copy("无法更换代码。", "Could not replace the code."));
  }

  function startIdentityUpgrade() {
    localStorage.setItem(IDENTITY_UPGRADE_PENDING_KEY, "true");
    setIdentityUpgradePending(true);
    setLoginEmail("");
    setMode("signup");
    setMessage(copy("使用新邮箱注册，或切换到登录并使用已有个人账号；成功后会自动保留当前小组和想看。", "Register with a new email, or sign in to an existing personal account. Your Film Fam and marks will be kept automatically."));
  }

  async function finishIdentityUpgrade() {
    if (!user || !channelIdentity.identity || upgradeMergeRef.current) return;
    upgradeMergeRef.current = true;
    setBusy(true);
    const channelId = await channelIdentity.mergeIntoAccount();
    setBusy(false);
    upgradeMergeRef.current = false;
    if (!channelId) {
      setMode("channel_identity");
      setMessage(copy("个人账号已登录，但自动连接没有完成。小组身份和原凭证仍然安全，请点击“完成升级”重试。", "Your personal account is signed in, but the connection did not finish. The Film Fam profile and credentials are still safe; choose “Finish upgrade” to retry."));
      dialogRef.current?.showModal();
      return;
    }
    localStorage.removeItem(IDENTITY_UPGRADE_PENDING_KEY);
    setIdentityUpgradePending(false);
    notifyChannelsChanged();
    setMessage(copy("已升级为个人账号，并保留原有观影小组、角色和想看。", "Upgraded to a personal account while keeping the Film Fam, role, and marks."));
    dialogRef.current?.close();
  }

  async function copyIdentityCredentials() {
    if (!channelIdentity.identity || !channelIdentity.savedCode) {
      setMessage(copy("此设备没有保存个人代码；请更换代码后立即复制。", "This device did not save the personal code. Replace it and copy the new code immediately."));
      return;
    }
    await navigator.clipboard.writeText(copy(`小组编号：${channelIdentity.identity.publicChannelId}\n个人代码：${channelIdentity.savedCode}`, `Film Fam ID: ${channelIdentity.identity.publicChannelId}\nPersonal code: ${channelIdentity.savedCode}`));
    setMessage(copy("小组编号和个人代码已复制。个人代码请勿分享；丢失后无法找回。", "Film Fam ID and personal code copied. Do not share the personal code; a lost code cannot be recovered."));
  }

  function enterMyGroup(channelId: string) {
    setCompletedGroupId(null);
    setMessage(null);
    dialogRef.current?.close();
    onOpenGroup?.(channelId);
  }

  const modeTitle = mode === "login" ? copy("个人账号登录", "Personal account sign in")
    : mode === "signup" ? copy("创建个人账号", "Create a personal account")
    : mode === "resend" ? copy("重发验证邮件", "Resend verification email")
    : mode === "reset" ? copy("找回账号", "Recover account")
    : mode === "account_summary" || mode === "change_password" ? copy("个人账号", "Personal account")
    : mode === "channel_login" ? copy("小组身份登录", "Film Fam profile sign in")
    : mode === "channel_create_choice" ? copy("怎样创建观影小组？", "How would you like to create a Film Fam?")
    : mode === "channel_create" ? copy("创建小组身份", "Create a Film Fam profile")
    : mode === "channel_identity" ? copy("小组身份", "Film Fam profile")
    : mode === "channel_merge" && completedGroupId ? copy("连接完成", "Connection complete")
    : mode === "channel_merge" ? copy("连接以前的小组身份", "Connect an existing Film Fam profile")
    : copy("设置新密码", "Set a new password");
  const submitLabel = busy ? copy("请稍候…", "Please wait…")
    : mode === "login" ? copy("登录", "Sign in")
    : mode === "signup" ? copy("创建个人账号", "Create personal account")
    : mode === "resend" && resendCooldown > 0 ? copy(`${resendCooldown} 秒后可重发`, `Resend in ${resendCooldown}s`)
    : mode === "resend" ? copy("重新发送", "Resend")
    : mode === "reset" ? copy("发送重设邮件", "Send reset email")
    : mode === "change_password" ? copy("保存新密码", "Save new password")
    : mode === "channel_login" ? copy("进入观影小组", "Enter Film Fam")
    : mode === "channel_create" ? copy("创建并获取个人代码", "Create and get personal code")
    : mode === "channel_merge" ? copy("确认连接并合并", "Connect and merge")
    : copy("更新密码", "Update password");

  return (
    <div className={`account-control${lightBackground ? " on-light" : ""}`}>
      {loading || channelIdentity.loading ? null : channelIdentity.identity && !user ? (
        <>
          {onOpenNotifications && <button
            aria-label={channelIdentity.unreadNotificationCount > 0 ? copy(`提醒，${channelIdentity.unreadNotificationCount} 条未读`, `Notifications, ${channelIdentity.unreadNotificationCount} unread`) : copy("提醒", "Notifications")}
            aria-pressed={notificationsOpen}
            className={`account-reminders${notificationsOpen ? " active" : ""}`}
            onClick={onOpenNotifications}
            title={copy("提醒", "Notifications")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            {channelIdentity.unreadNotificationCount > 0 && <b>{channelIdentity.unreadNotificationCount > 99 ? "99+" : channelIdentity.unreadNotificationCount}</b>}
          </button>}
          <span>{channelIdentity.identity.displayName} <small>{copy("小组身份", "Film Fam profile")}</small></span>
          <button onClick={() => { setMode("channel_identity"); setMessage(null); dialogRef.current?.showModal(); }} type="button">{copy("身份", "Profile")}</button>
          <button disabled={busy} onClick={() => void channelIdentity.logout()} type="button">{copy("退出", "Sign out")}</button>
        </>
      ) : user ? (
        <>
          {onOpenNotifications && <button
            aria-label={reminderCount > 0 ? copy(`提醒，${reminderCount} 条未读`, `Notifications, ${reminderCount} unread`) : copy("提醒", "Notifications")}
            aria-pressed={notificationsOpen}
            className={`account-reminders${notificationsOpen ? " active" : ""}`}
            onClick={onOpenNotifications}
            title={copy("提醒", "Notifications")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            {reminderCount > 0 && <b>{reminderCount > 99 ? "99+" : reminderCount}</b>}
          </button>}
          <span>@{username ?? "account"}</span>
          {channelIdentity.identity && <button disabled={busy} onClick={() => void finishIdentityUpgrade()} type="button">{copy("完成小组身份升级", "Finish Film Fam profile upgrade")}</button>}
          <button onClick={() => { setMode("change_password"); setMessage(null); dialogRef.current?.showModal(); }} type="button">{copy("修改密码", "Change password")}</button>
          <button onClick={() => { setCompletedGroupId(null); setMode("channel_merge"); setMessage(null); dialogRef.current?.showModal(); }} type="button">{copy("连接小组身份", "Connect Film Fam profile")}</button>
          <button disabled={busy} onClick={signOut} type="button">{copy("退出", "Sign out")}</button>
        </>
      ) : (
        <>
          <button onClick={() => { setMode("channel_login"); setMessage(null); dialogRef.current?.showModal(); }} type="button">{copy("小组身份登录", "Film Fam profile sign in")}</button>
          <button onClick={() => { setMode("login"); setMessage(null); dialogRef.current?.showModal(); }} type="button">{copy("个人账号", "Personal account")}</button>
        </>
      )}
      <dialog className="auth-dialog" ref={dialogRef}>
        <form method="dialog" className="dialog-close"><button aria-label={copy("关闭", "Close")} type="submit">×</button></form>
        {mode !== "account_summary" && mode !== "change_password" && mode !== "channel_identity" && mode !== "channel_merge" && mode !== "channel_create_choice" && <div className="auth-tabs">
          <button className={mode === "login" || mode === "signup" ? "active" : ""} onClick={() => { setMode("login"); setMessage(null); }} type="button">{copy("个人账号", "Personal account")}</button>
          <button className={mode === "channel_login" || mode === "channel_create" ? "active" : ""} onClick={() => { setMode("channel_login"); setMessage(null); }} type="button">{copy("小组身份", "Film Fam profile")}</button>
        </div>}
        <h2>{modeTitle}</h2>
        {mode === "account_summary" ? <div className="account-summary">
          <p className="account-summary-name">@{username ?? "account"}</p>
          <div className="account-summary-grid" aria-busy={!accountSummary && !accountSummaryError}>
            <article><strong>{accountSummary?.markedFilmCount ?? "—"}</strong><span>{copy("已标记电影", "Marked films")}</span></article>
            <article><strong>{accountSummary?.groupCount ?? "—"}</strong><span>{copy("观影小组", "Film Fams")}</span></article>
            <article><strong>{accountAge(user?.created_at, locale)}</strong><span>{copy("账号时长", "Account age")}</span></article>
          </div>
          {accountSummaryError && <p className="auth-message" role="status">{copy("暂时无法读取账号统计，请稍后重试。", "Could not load account statistics. Please try again.")}</p>}
          <button className="auth-submit" onClick={() => { setMode("change_password"); setMessage(null); }} type="button">{copy("修改密码", "Change password")}</button>
          <button className="auth-link" onClick={() => dialogRef.current?.close()} type="button">{copy("关闭", "Close")}</button>
        </div> : mode === "channel_identity" ? <div className="channel-identity-details">
          <p className="privacy-note">{copy("这个身份只能绑定同一个观影小组。小组编号可分享，个人代码是登录凭证，请勿分享；代码丢失后无法找回。", "This profile belongs to one Film Fam. You may share the Film Fam ID, but the personal code is a private sign-in credential. A lost code cannot be recovered.")}</p>
          <label>{copy("小组编号", "Film Fam ID")}<code>{channelIdentity.identity?.publicChannelId}</code></label>
          <label>{copy("个人代码", "Personal code")}<code>{channelIdentity.savedCode ?? copy("此设备没有保存代码", "No code saved on this device")}</code></label>
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" disabled={!channelIdentity.savedCode} onClick={() => void copyIdentityCredentials()} type="button">{copy("复制登录信息", "Copy sign-in details")}</button>
          <button className="auth-submit" disabled={busy} onClick={() => void rotateIdentityCode()} type="button">{copy("更换个人代码", "Replace personal code")}</button>
          {channelIdentity.identity && <button className="auth-submit" onClick={() => enterMyGroup(channelIdentity.identity!.channelId)} type="button">{copy("进入我的小组", "Open my Film Fam")}</button>}
          {user
            ? <button className="auth-link" disabled={busy} onClick={() => void finishIdentityUpgrade()} type="button">{copy("完成升级并保留小组和想看", "Finish upgrade and keep Film Fam and marks")}</button>
            : <button className="auth-link" onClick={startIdentityUpgrade} type="button">{copy("升级为个人账号", "Upgrade to personal account")}</button>}
          <button className="auth-link" onClick={() => dialogRef.current?.close()} type="button">{copy("关闭", "Close")}</button>
        </div> : mode === "channel_merge" && completedGroupId ? <div className="dialog-completion">
          <p>{copy("小组身份已连接到个人账号，原个人代码已经失效。观影小组、角色和想看均已保留。", "The Film Fam profile is connected to your personal account, and the old personal code no longer works. Your Film Fam, role, and marks were kept.")}</p>
          <button className="auth-submit" onClick={() => enterMyGroup(completedGroupId)} type="button">{copy("进入我的小组", "Open my Film Fam")}</button>
          <button className="auth-link" onClick={() => { setCompletedGroupId(null); dialogRef.current?.close(); }} type="button">{copy("关闭", "Close")}</button>
        </div> : mode === "channel_create_choice" ? <div className="identity-choice">
          <p className="privacy-note">{copy("观影小组只有受邀成员可见。两种方式都能创建小组、邀请朋友并共同标记想看的具体场次。", "A Film Fam is visible only to invited members. Both options let you create a Film Fam, invite friends, and mark exact showtimes together.")}</p>
          <button onClick={() => { setMode("signup"); setMessage(null); }} type="button"><b>{copy("使用个人账号", "Use a personal account")}</b><span>{copy("可加入多个小组，想看默认私密，邮箱可找回。适合长期使用。", "Join multiple Film Fams, keep marks private by default, and recover by email. Best for ongoing use.")}</span></button>
          <button onClick={() => { setMode("channel_create"); setMessage(null); }} type="button"><b>{copy("使用小组身份（无需邮箱）", "Use a Film Fam profile (no email required)")}</b><span>{copy("只能绑定同一个小组，所有想看直接分享；个人代码丢失后无法找回。", "Linked to one Film Fam with all marks shared directly; a lost personal code cannot be recovered.")}</span></button>
          <button className="auth-link" onClick={() => { setMode("login"); setMessage(null); }} type="button">{copy("已有个人账号？登录", "Already have a personal account? Sign in")}</button>
        </div> : <>
        <p className="privacy-note">{mode.startsWith("channel_")
          ? copy("小组身份无需邮箱，只能绑定同一个观影小组；所有想看会直接分享，个人代码丢失后无法找回。以后可升级为个人账号并保留小组和想看。", "A Film Fam profile needs no email and belongs to one Film Fam; every mark is shared directly, and a lost personal code cannot be recovered. Upgrade later and keep the Film Fam and marks.")
          : copy("个人账号可加入多个观影小组。想看默认仅自己可见，由你选择分享；邮箱仅用于登录、验证和找回，不会公开。", "A personal account can join multiple Film Fams. Marks start private and you choose what to share; your email is used only for sign-in, verification, and recovery, and is never public.")}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === "channel_create" && <>
            <label>{copy("观影小组名称", "Film Fam name")}<input maxLength={80} name="channel_name" required /></label>
            <label>{copy("昵称", "Display name")}<input maxLength={40} name="display_name" required /><small>{copy("创建后不可修改", "Cannot be changed after creation")}</small></label>
          </>}
          {(mode === "channel_login" || mode === "channel_merge") && <>
            <label>{copy("小组编号", "Film Fam ID")}<input autoCapitalize="characters" name="public_channel_id" pattern="CH-[A-HJ-NP-Za-hj-np-z2-9]{8}" placeholder="CH-7KDM4QPX" required /></label>
            <label>{copy("个人代码", "Personal code")}<input autoCapitalize="characters" name="access_code" pattern="[A-HJ-NP-Za-hj-np-z2-9]{4}-?[A-HJ-NP-Za-hj-np-z2-9]{4}" placeholder="7KDM-4QPX" required /></label>
          </>}
          {mode === "signup" && (
            <label>Username<input autoComplete="username" maxLength={24} minLength={3} name="username" pattern="[a-zA-Z0-9_]+" required /></label>
          )}
          {!mode.startsWith("channel_") && mode !== "update_password" && mode !== "change_password" && <label>{copy("邮箱", "Email")}<input autoComplete="email" defaultValue={loginEmail} key={`${mode}:${loginEmail}`} name="email" required type="email" /></label>}
          {mode === "change_password" ? <>
            <label>{copy("当前密码", "Current password")}<input autoComplete="current-password" name="current_password" required type="password" /></label>
            <label>{copy("新密码", "New password")}<input autoComplete="new-password" minLength={8} name="password" required type="password" /></label>
            <label>{copy("确认新密码", "Confirm new password")}<input autoComplete="new-password" minLength={8} name="password_confirmation" required type="password" /></label>
          </> : !mode.startsWith("channel_") && mode !== "reset" && mode !== "resend" && <label>{copy("密码", "Password")}<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} name="password" required type="password" /></label>}
          {message && <p className="auth-message" role="status">{message}</p>}
          {turnstileSiteKey && CAPTCHA_MODES.has(mode) && <TurnstileWidget
            onTokenChange={setCaptchaToken}
            resetKey={captchaResetKey}
          />}
          <button
            className="auth-submit"
            disabled={busy || (mode === "resend" && resendCooldown > 0) || (Boolean(turnstileSiteKey) && CAPTCHA_MODES.has(mode) && !captchaToken)}
            type="submit"
          >{submitLabel}</button>
          {mode === "channel_login" && <button className="auth-link" onClick={() => { setMode("channel_create_choice"); setMessage(null); }} type="button">{copy("还没有观影小组？创建一个", "No Film Fam yet? Create one")}</button>}
          {mode === "channel_create" && <button className="auth-link" onClick={() => { setMode("channel_login"); setMessage(null); }} type="button">{copy("已有小组编号和个人代码", "I have a Film Fam ID and personal code")}</button>}
          {mode === "login" && <button className="auth-link" onClick={() => { setMode("signup"); setMessage(null); }} type="button">{copy("还没有个人账号？注册", "No personal account? Register")}</button>}
          {mode === "signup" && loginEmail && <button className="auth-submit" onClick={() => { setMode("login"); setMessage(copy("请输入这个邮箱对应的个人账号密码。登录成功后会继续连接小组身份。", "Enter the personal-account password for this email. After signing in, the Film Fam profile will continue connecting.")); }} type="button">{copy("转到个人账号登录", "Go to personal account sign in")}</button>}
          {mode === "signup" && !loginEmail && <button className="auth-link" onClick={() => { setMode("login"); setMessage(null); }} type="button">{copy("已有个人账号？转到登录", "Already have a personal account? Sign in")}</button>}
          {mode === "login" && <button className="auth-link" onClick={() => { setMode("reset"); setMessage(null); }} type="button">{copy("忘记密码？", "Forgot password?")}</button>}
          {mode === "signup" && <button className="auth-link" onClick={() => { setMode("resend"); setMessage(null); }} type="button">{copy("没有收到验证邮件？", "Didn’t receive the verification email?")}</button>}
          {(mode === "resend" || mode === "reset" || mode === "update_password") && <button className="auth-link" onClick={() => { setMode("login"); setMessage(null); }} type="button">{copy("返回登录", "Back to sign in")}</button>}
          {mode === "change_password" && <button className="auth-link" onClick={() => dialogRef.current?.close()} type="button">{copy("取消", "Cancel")}</button>}
          {mode === "channel_merge" && <button className="auth-link" onClick={() => dialogRef.current?.close()} type="button">{copy("取消并关闭", "Cancel and close")}</button>}
        </form>
        </>}
      </dialog>
    </div>
  );
}
