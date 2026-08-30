import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const allowedOrigins = new Set([
  "https://movie-together-nu.vercel.app",
  "https://nyc-rep-cinema-week.wyzmanto.chatgpt.site",
]);
const usernamePattern = /^[a-z0-9_]{3,24}$/;
const recoveryPattern = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/;
const commonPasswords = new Set([
  "123456", "12345678", "password", "password1", "qwerty", "qwerty123",
  "111111", "abc123", "letmein", "welcome", "iloveyou", "admin123",
]);

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : [...allowedOrigins][0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

function readKey(dictionaryName: string, legacyName: string): string {
  const dictionary = Deno.env.get(dictionaryName);
  if (dictionary) {
    const keys = JSON.parse(dictionary) as Record<string, string>;
    if (keys.default) return keys.default;
  }
  const legacy = Deno.env.get(legacyName);
  if (!legacy) throw new Error(`${dictionaryName} is unavailable.`);
  return legacy;
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
}

function newInternalEmail(): string {
  return `account-${crypto.randomUUID().replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "")}@accounts.nyc-movie-together.invalid`;
}

function validPassword(value: unknown, username: string): value is string {
  if (typeof value !== "string" || value.length < 6 || value.length > 128) return false;
  const lowered = value.toLocaleLowerCase("en-US");
  return !commonPasswords.has(lowered) && lowered !== username && !/^(.)(\1){5,}$/.test(value);
}

function recoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("").match(/.{4}/g)!.join("-");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyCaptcha(token: unknown, remoteIp: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY")?.trim();
  if (!secret) return true;
  if (typeof token !== "string" || token.length < 10) return false;
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp !== "unknown") form.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}

function sessionBody(session: { access_token: string; refresh_token: string }, extra: Record<string, unknown> = {}) {
  return { accessToken: session.access_token, refreshToken: session.refresh_token, ...extra };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "unavailable" }, 405);
  if (Number(request.headers.get("content-length") ?? "0") > 4096) return json(request, { error: "unavailable" }, 413);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is unavailable.");
    const publishableKey = readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const remoteIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const fingerprint = await sha256(`${secretKey}:account-auth:${remoteIp}`);

    if (action === "login" || action === "signup" || action === "recover") {
      const username = normalizeUsername(body.username);
      if (!usernamePattern.test(username)) return json(request, { error: action === "signup" ? "username_taken" : "invalid_credentials" });
      const { data: guardData } = await admin.rpc("account_auth_guard", {
        request_fingerprint_hash: fingerprint,
        requested_username: username,
        requested_action: action,
      });
      const guard = (guardData ?? {}) as { allowed?: boolean; captchaRequired?: boolean };
      if (!guard.allowed) return json(request, { error: "rate_limited" });
      if (guard.captchaRequired && !await verifyCaptcha(body.captchaToken, remoteIp)) {
        return json(request, { error: "captcha_required" });
      }

      const record = async (succeeded: boolean) => {
        await admin.rpc("record_account_auth_attempt", {
          request_fingerprint_hash: fingerprint,
          requested_username: username,
          requested_action: action,
          attempt_succeeded: succeeded,
        });
      };

      if (action === "login") {
        if (typeof body.password !== "string") return json(request, { error: "invalid_credentials" });
        const { data: profile } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
        const { data: targetAuth } = await admin.auth.admin.getUserById(
          profile?.id ?? "00000000-0000-0000-0000-000000000000",
        );
        const loginEmail = targetAuth?.user?.email ?? `missing-${crypto.randomUUID()}@accounts.nyc-movie-together.invalid`;
        const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data, error } = await authClient.auth.signInWithPassword({
          email: loginEmail,
          password: body.password,
        });
        await record(!error && Boolean(data.session));
        if (error || !data.session || !data.user) return json(request, { error: "invalid_credentials" });
        const { data: existingRecovery } = await admin.from("account_recovery_credentials")
          .select("user_id").eq("user_id", data.user.id).maybeSingle();
        if (!existingRecovery) {
          const firstRecoveryCode = recoveryCode();
          const { data: stored } = await admin.rpc("set_account_recovery_code", {
            target_user_id: data.user.id,
            recovery_code: firstRecoveryCode,
          });
          if (!stored) return json(request, { error: "unavailable" });
          return json(request, sessionBody(data.session, { recoveryCode: firstRecoveryCode }));
        }
        return json(request, sessionBody(data.session));
      }

      if (!validPassword(body.password, username)) {
        await record(false);
        return json(request, { error: "weak_password" });
      }

      if (action === "signup") {
        const [{ data: existingProfile }, { data: deletedName }] = await Promise.all([
          admin.from("profiles").select("id").eq("username", username).maybeSingle(),
          admin.from("deleted_usernames").select("username").eq("username", username).maybeSingle(),
        ]);
        if (existingProfile || deletedName) {
          await record(false);
          return json(request, { error: "username_taken" });
        }
        const accountEmail = newInternalEmail();
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: accountEmail,
          password: body.password,
          email_confirm: true,
          user_metadata: { username },
        });
        if (createError || !created.user) {
          await record(false);
          return json(request, { error: "username_taken" });
        }
        const nextRecoveryCode = recoveryCode();
        const { data: stored } = await admin.rpc("set_account_recovery_code", {
          target_user_id: created.user.id,
          recovery_code: nextRecoveryCode,
        });
        if (!stored) {
          await admin.auth.admin.deleteUser(created.user.id);
          await record(false);
          return json(request, { error: "unavailable" });
        }
        const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: signedIn, error: signInError } = await authClient.auth.signInWithPassword({
          email: accountEmail, password: body.password,
        });
        if (signInError || !signedIn.session) {
          await admin.auth.admin.deleteUser(created.user.id);
          await record(false);
          return json(request, { error: "unavailable" });
        }
        await record(true);
        return json(request, sessionBody(signedIn.session, { recoveryCode: nextRecoveryCode }));
      }

      const suppliedRecovery = typeof body.recoveryCode === "string" ? body.recoveryCode.trim().toUpperCase() : "";
      if (!recoveryPattern.test(suppliedRecovery)) {
        await record(false);
        return json(request, { error: "invalid_recovery" });
      }
      const { data: userId } = await admin.rpc("verify_account_recovery_code", {
        requested_username: username,
        recovery_code: suppliedRecovery,
      });
      if (typeof userId !== "string") {
        await record(false);
        return json(request, { error: "invalid_recovery" });
      }
      const nextRecoveryCode = recoveryCode();
      const { data: stored } = await admin.rpc("set_account_recovery_code", {
        target_user_id: userId,
        recovery_code: nextRecoveryCode,
      });
      if (!stored) {
        await record(false);
        return json(request, { error: "unavailable" });
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: body.password as string });
      if (updateError) {
        await record(false);
        return json(request, { error: "unavailable" });
      }
      const { error: revokeError } = await admin.rpc("revoke_all_account_sessions", { target_user_id: userId });
      if (revokeError) {
        await record(false);
        return json(request, { error: "unavailable" });
      }
      const { data: recoveredAuth } = await admin.auth.admin.getUserById(userId);
      if (!recoveredAuth?.user?.email) {
        await record(false);
        return json(request, { error: "unavailable" });
      }
      const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: signedIn, error: signInError } = await authClient.auth.signInWithPassword({
        email: recoveredAuth.user.email, password: body.password as string,
      });
      await record(!signInError && Boolean(signedIn.session));
      return signInError || !signedIn.session
        ? json(request, { error: "unavailable" })
        : json(request, sessionBody(signedIn.session, { recoveryCode: nextRecoveryCode }));
    }

    const authorization = request.headers.get("authorization");
    if (!authorization) return json(request, { error: "invalid_credentials" });
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return json(request, { error: "invalid_credentials" });

    const { data: currentProfile } = await admin.from("profiles").select("username").eq("id", authData.user.id).maybeSingle();
    const currentUsername = currentProfile?.username ?? "";

    if (action === "change_password") {
      if (!validPassword(body.newPassword, currentUsername)) {
        return json(request, { error: "weak_password" });
      }
      if (!usernamePattern.test(currentUsername) || typeof body.currentPassword !== "string" || !authData.user.email) {
        return json(request, { error: "invalid_credentials" });
      }
      const { data: guardData } = await admin.rpc("account_auth_guard", {
        request_fingerprint_hash: fingerprint,
        requested_username: currentUsername,
        requested_action: "change_password",
      });
      const guard = (guardData ?? {}) as { allowed?: boolean; captchaRequired?: boolean };
      if (!guard.allowed) return json(request, { error: "rate_limited" });
      if (guard.captchaRequired && !await verifyCaptcha(body.captchaToken, remoteIp)) {
        return json(request, { error: "captcha_required" });
      }
      const verifier = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: passwordError } = await verifier.auth.signInWithPassword({ email: authData.user.email, password: body.currentPassword });
      await admin.rpc("record_account_auth_attempt", {
        request_fingerprint_hash: fingerprint,
        requested_username: currentUsername,
        requested_action: "change_password",
        attempt_succeeded: !passwordError,
      });
      if (passwordError) return json(request, { error: "invalid_credentials" });
      const accessToken = authorization.replace(/^Bearer\s+/i, "");
      const { error: revokeError } = await admin.auth.admin.signOut(accessToken, "others");
      if (revokeError) return json(request, { error: "unavailable" });
      const { error: updateError } = await admin.auth.admin.updateUserById(authData.user.id, { password: body.newPassword as string });
      return updateError ? json(request, { error: "unavailable" }) : json(request, { ok: true });
    }

    if (action === "rotate_recovery") {
      const nextRecoveryCode = recoveryCode();
      const accessToken = authorization.replace(/^Bearer\s+/i, "");
      const { error: revokeError } = await admin.auth.admin.signOut(accessToken, "others");
      if (revokeError) return json(request, { error: "unavailable" });
      const { data: stored } = await admin.rpc("set_account_recovery_code", {
        target_user_id: authData.user.id,
        recovery_code: nextRecoveryCode,
      });
      return stored ? json(request, { recoveryCode: nextRecoveryCode }) : json(request, { error: "unavailable" });
    }

    if (action === "delete") {
      const username = normalizeUsername(body.username);
      if (currentUsername !== username || typeof body.password !== "string" || !authData.user.email) {
        return json(request, { error: "invalid_credentials" });
      }
      const { data: guardData } = await admin.rpc("account_auth_guard", {
        request_fingerprint_hash: fingerprint,
        requested_username: currentUsername,
        requested_action: "delete",
      });
      const guard = (guardData ?? {}) as { allowed?: boolean; captchaRequired?: boolean };
      if (!guard.allowed) return json(request, { error: "rate_limited" });
      if (guard.captchaRequired && !await verifyCaptcha(body.captchaToken, remoteIp)) {
        return json(request, { error: "captcha_required" });
      }
      const verifier = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: passwordError } = await verifier.auth.signInWithPassword({ email: authData.user.email, password: body.password });
      await admin.rpc("record_account_auth_attempt", {
        request_fingerprint_hash: fingerprint,
        requested_username: currentUsername,
        requested_action: "delete",
        attempt_succeeded: !passwordError,
      });
      if (passwordError) return json(request, { error: "invalid_credentials" });
      const { data: prepared } = await admin.rpc("prepare_account_deletion", { target_user_id: authData.user.id });
      if (!prepared) return json(request, { error: "owned_channels" });
      const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
      return deleteError ? json(request, { error: "unavailable" }) : json(request, { ok: true });
    }

    return json(request, { error: "unavailable" });
  } catch {
    return json(request, { error: "unavailable" }, 500);
  }
});
