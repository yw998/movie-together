import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { normalizeUsername, usernameError } from "../lib/username";
import { authConfigured, supabase } from "./supabase";

type Mode = "login" | "signup";

export function AccountControl() {
  const client = supabase;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let active = true;
    const loadProfile = async (nextUser: User | null) => {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setUsername(null);
        return;
      }
      const { data } = await client
        .from("profiles")
        .select("username")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (active) setUsername(data?.username ?? null);
    };
    void client.auth.getUser().then(({ data }) => loadProfile(data.user));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session?.user ?? null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  if (!authConfigured || !client) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setMessage(null);
    if (password.length < 8) {
      setMessage("密码至少需要 8 位。请使用不与其他网站重复的密码。");
      return;
    }
    setBusy(true);
    if (mode === "signup") {
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
        options: { data: { username: normalizeUsername(requestedUsername) } },
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
    <div className="account-control">
      {user ? (
        <>
          <span>@{username ?? "account"}</span>
          <button disabled={busy} onClick={signOut} type="button">退出</button>
        </>
      ) : (
        <button onClick={() => dialogRef.current?.showModal()} type="button">登录 / 注册</button>
      )}
      <dialog className="auth-dialog" ref={dialogRef}>
        <form method="dialog" className="dialog-close"><button aria-label="关闭" type="submit">×</button></form>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(null); }} type="button">登录</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setMessage(null); }} type="button">注册</button>
        </div>
        <h2>{mode === "login" ? "欢迎回来" : "创建账号"}</h2>
        <p className="privacy-note">其他用户只会看到 username。邮箱仅用于登录、验证和找回，不会公开。</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label>Username<input autoComplete="username" maxLength={24} minLength={3} name="username" pattern="[a-zA-Z0-9_]+" required /></label>
          )}
          <label>邮箱<input autoComplete="email" name="email" required type="email" /></label>
          <label>密码<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} name="password" required type="password" /></label>
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" disabled={busy} type="submit">{busy ? "请稍候…" : mode === "login" ? "登录" : "创建账号"}</button>
        </form>
      </dialog>
    </div>
  );
}
