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

    if (action === "preview") {
      if (!isToken(body.inviteToken)) return json(request, { error: "邀请链接无效或已过期。" }, 400);
      const { data, error } = await admin.rpc("preview_channel_invite", {
        invite_token: body.inviteToken,
      });
      if (error || !data) return json(request, { error: "邀请链接无效或已过期。" }, 404);
      return json(request, { invite: data });
    }

    if (action === "guest_join") {
      const guestName = typeof body.guestName === "string" ? body.guestName.trim() : "";
      if (!isToken(body.inviteToken) || guestName.length < 1 || guestName.length > 40) {
        return json(request, { error: "请填写 1–40 个字符的访客名称。" }, 400);
      }
      const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const fingerprint = await sha256(`${secretKey}:guest-join:${forwardedFor}`);
      const { data, error } = await admin.rpc("create_channel_guest_limited", {
        invite_token: body.inviteToken,
        guest_name: guestName,
        request_fingerprint_hash: fingerprint,
      });
      const guest = Array.isArray(data) ? data[0] : null;
      if (error || !guest) return json(request, { error: "邀请链接无效、已过期或请求过于频繁。" }, 400);
      return json(request, {
        guest: { id: guest.guest_id, channelId: guest.channel_id, accessCode: guest.access_code },
      }, 201);
    }

    if (action === "guest_access") {
      if (!isUuid(body.guestId) || !isToken(body.accessCode)) {
        return json(request, { error: "访客 ID 或访问代码不正确。" }, 400);
      }
      const { data, error } = await admin.rpc("read_channel_as_guest", {
        target_guest_id: body.guestId,
        access_code: body.accessCode,
      });
      if (error || !data) return json(request, { error: "访问代码不正确、已撤销或尝试次数过多。" }, 403);
      return json(request, { view: data });
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
