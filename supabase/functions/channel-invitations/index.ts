import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const allowedOrigins = new Set([
  "https://movie-together-nu.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://movie-together-nu.vercel.app",
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

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIdentitySession(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isPublicChannelId(value: unknown): value is string {
  return typeof value === "string" && /^CH-[A-HJ-NP-Z2-9]{8}$/i.test(value.trim());
}

function isAccessCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i.test(value.trim());
}

function isParticipantKind(value: unknown): value is "account" | "channel_only" {
  return value === "account" || value === "channel_only";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 4096) return json(request, { error: "Request is too large." }, 413);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is unavailable.");
    const publishableKey = readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const fingerprint = await sha256(`${secretKey}:channel-identity:${forwardedFor}`);

    if (action === "identity_create_channel") {
      const channelName = typeof body.channelName === "string" ? body.channelName.trim() : "";
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (channelName.length < 1 || channelName.length > 80 || displayName.length < 1 || displayName.length > 40) {
        return json(request, { error: "请填写有效的 Channel 名称和显示名。" }, 400);
      }
      const { data, error } = await admin.rpc("create_channel_identity_owner", {
        channel_name: channelName,
        identity_display_name: displayName,
        request_fingerprint_hash: fingerprint,
      });
      if (error || !data) return json(request, { error: "暂时无法创建 Channel；名称可能已被使用或请求过于频繁。" }, 400);
      return json(request, data, 201);
    }

    if (action === "identity_join") {
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (!isToken(body.inviteToken) || displayName.length < 1 || displayName.length > 40) {
        return json(request, { error: "邀请链接无效，或显示名不符合要求。" }, 400);
      }
      const { data, error } = await admin.rpc("create_channel_identity_member", {
        invite_token: body.inviteToken,
        identity_display_name: displayName,
        request_fingerprint_hash: fingerprint,
      });
      if (error || !data) return json(request, { error: "无法加入；链接可能已失效，或显示名已被使用。" }, 400);
      return json(request, data, 201);
    }

    if (action === "identity_login") {
      if (!isPublicChannelId(body.publicChannelId) || !isAccessCode(body.accessCode)) {
        return json(request, { error: "Channel ID 或个人代码不正确。" }, 400);
      }
      const { data, error } = await admin.rpc("login_channel_identity", {
        target_public_channel_id: body.publicChannelId.trim().toUpperCase(),
        access_code: body.accessCode.trim().toUpperCase(),
        request_fingerprint_hash: fingerprint,
      });
      if (error || !data) return json(request, { error: "Channel ID 或个人代码不正确。" }, 403);
      return json(request, data);
    }

    if (action === "identity_session") {
      if (!isIdentitySession(body.sessionToken)) return json(request, { error: "身份会话已失效。" }, 401);
      const { data, error } = await admin.rpc("read_channel_identity_session", { session_token: body.sessionToken });
      if (error || !data) return json(request, { error: "身份会话已失效。" }, 401);
      return json(request, { view: data });
    }

    if (action === "identity_toggle_mark") {
      if (!isIdentitySession(body.sessionToken) || typeof body.windowStart !== "string" || typeof body.showingId !== "string") {
        return json(request, { error: "请求无效。" }, 400);
      }
      const { data, error } = await admin.rpc("toggle_channel_identity_mark", {
        session_token: body.sessionToken,
        target_window_start: body.windowStart,
        target_showing_id: body.showingId,
      });
      if (error || !data) return json(request, { error: "无法更新想看标记。" }, 403);
      return json(request, data);
    }

    if (action === "identity_notifications") {
      if (!isIdentitySession(body.sessionToken)) return json(request, { error: "身份会话已失效。" }, 401);
      const { data, error } = await admin.rpc("list_channel_identity_notifications", {
        session_token: body.sessionToken,
      });
      if (error) return json(request, { error: "无法读取提醒。" }, 403);
      return json(request, { notifications: data ?? [] });
    }

    if (action === "identity_notifications_read") {
      if (!isIdentitySession(body.sessionToken)) return json(request, { error: "身份会话已失效。" }, 401);
      const { data, error } = await admin.rpc("mark_channel_identity_notifications_read", {
        session_token: body.sessionToken,
      });
      if (error || !data) return json(request, { error: "无法标记提醒为已读。" }, 403);
      return json(request, { ok: true });
    }

    if (action === "identity_rotate_code") {
      if (!isIdentitySession(body.sessionToken)) return json(request, { error: "身份会话已失效。" }, 401);
      const { data, error } = await admin.rpc("rotate_channel_identity_code", { session_token: body.sessionToken });
      if (error || !data) return json(request, { error: "无法更换个人代码。" }, 403);
      return json(request, data);
    }

    if (action === "identity_create_link") {
      if (!isIdentitySession(body.sessionToken)) return json(request, { error: "身份会话已失效。" }, 401);
      const { data, error } = await admin.rpc("create_channel_identity_invite_link", { session_token: body.sessionToken });
      const link = Array.isArray(data) ? data[0] : null;
      if (error || !link) return json(request, { error: "只有 Channel owner 可以创建邀请链接。" }, 403);
      return json(request, { link });
    }

    if (action === "identity_revoke_link") {
      if (!isIdentitySession(body.sessionToken) || !isUuid(body.linkId)) return json(request, { error: "请求无效。" }, 400);
      const { data, error } = await admin.rpc("revoke_channel_identity_invite_link", {
        session_token: body.sessionToken,
        target_link_id: body.linkId,
      });
      if (error || !data) return json(request, { error: "无法撤销邀请链接。" }, 403);
      return json(request, { ok: true });
    }

    if (action === "identity_rename") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!isIdentitySession(body.sessionToken) || name.length < 1 || name.length > 80) {
        return json(request, { error: "请输入 1 至 80 个字符的小组名称。" }, 400);
      }
      const { data, error } = await admin.rpc("rename_channel_as_identity", {
        session_token: body.sessionToken,
        new_name: name,
      });
      if (error || !data) return json(request, { error: "只有创建者可以重命名观影小组。" }, 403);
      return json(request, { ok: true });
    }

    if (action === "identity_transfer_owner") {
      if (!isIdentitySession(body.sessionToken) || !isParticipantKind(body.participantKind) || !isUuid(body.participantId)) {
        return json(request, { error: "请选择有效的小组成员。" }, 400);
      }
      const { data, error } = await admin.rpc("transfer_channel_ownership_as_identity", {
        session_token: body.sessionToken,
        target_kind: body.participantKind,
        target_participant_id: body.participantId,
      });
      if (error || !data) return json(request, { error: "无法转让创建者身份。" }, 403);
      return json(request, { ok: true });
    }

    if (action === "identity_leave" || action === "identity_delete_channel") {
      if (!isIdentitySession(body.sessionToken)) return json(request, { error: "身份会话已失效。" }, 401);
      const rpcName = action === "identity_leave" ? "leave_channel_identity" : "delete_channel_as_identity";
      const { data, error } = await admin.rpc(rpcName, { session_token: body.sessionToken });
      if (error || !data) return json(request, { error: "无法完成这个操作。" }, 403);
      return json(request, { ok: true });
    }

    if (action === "identity_remove_member") {
      if (!isIdentitySession(body.sessionToken) || !isParticipantKind(body.participantKind) || !isUuid(body.participantId)) {
        return json(request, { error: "请求无效。" }, 400);
      }
      const { data, error } = await admin.rpc("remove_channel_participant_as_identity", {
        session_token: body.sessionToken,
        target_kind: body.participantKind,
        target_participant_id: body.participantId,
      });
      if (error || !data) return json(request, { error: "无法移除这个成员。" }, 403);
      return json(request, { ok: true });
    }

    if (action === "identity_logout") {
      if (isIdentitySession(body.sessionToken)) await admin.rpc("logout_channel_identity", { session_token: body.sessionToken });
      return json(request, { ok: true });
    }

    if (action === "identity_merge") {
      const authorization = request.headers.get("authorization");
      if (!authorization) return json(request, { error: "请先登录正式账号。" }, 401);
      const userClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) return json(request, { error: "请重新登录正式账号。" }, 401);
      let mergeSession = isIdentitySession(body.sessionToken) ? body.sessionToken : null;
      if (!mergeSession && isPublicChannelId(body.publicChannelId) && isAccessCode(body.accessCode)) {
        const { data: loginData } = await admin.rpc("login_channel_identity", {
          target_public_channel_id: body.publicChannelId.trim().toUpperCase(),
          access_code: body.accessCode.trim().toUpperCase(),
          request_fingerprint_hash: fingerprint,
        });
        mergeSession = loginData?.sessionToken ?? null;
      }
      if (!mergeSession) return json(request, { error: "Channel ID 或个人代码不正确。" }, 403);
      const { data, error } = await admin.rpc("merge_channel_identity_into_account", {
        session_token: mergeSession,
        target_user_id: authData.user.id,
      });
      if (error || !data) return json(request, { error: "无法合并身份，请确认代码仍然有效。" }, 400);
      return json(request, { channelId: data });
    }

    if (action === "preview") {
      if (!isToken(body.inviteToken)) return json(request, { error: "邀请链接无效或已过期。" }, 400);
      const { data, error } = await admin.rpc("preview_channel_invite", {
        invite_token: body.inviteToken,
      });
      if (error || !data) return json(request, { error: "邀请链接无效或已过期。" }, 404);
      return json(request, { invite: data });
    }

    if (action === "email_invite") {
      const authorization = request.headers.get("authorization");
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (!authorization || !isUuid(body.channelId) || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
        return json(request, { error: "请求无效。" }, 400);
      }
      const userClient = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) return json(request, { error: "请重新登录。" }, 401);
      const { error } = await admin.rpc("invite_channel_user_by_email", {
        target_channel_id: body.channelId,
        inviter_user_id: authData.user.id,
        target_email: email,
      });
      if (error) return json(request, { error: "只有 Channel owner 可以发送邀请。" }, 403);
      return json(request, {
        message: "如果该邮箱对应一个可邀请账号，对方会在账号中看到邀请。",
      });
    }

    return json(request, { error: "Unknown action." }, 400);
  } catch {
    return json(request, { error: "服务暂时不可用，请稍后重试。" }, 500);
  }
});
