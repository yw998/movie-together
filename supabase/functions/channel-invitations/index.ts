import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const allowedOrigins = new Set([
  "https://movie-together-nu.vercel.app",
  "https://nyc-rep-cinema-week.wyzmanto.chatgpt.site",
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);
  if (Number(request.headers.get("content-length") ?? "0") > 1024) return json(request, { error: "Request is too large." }, 413);
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== "preview" || typeof body.inviteToken !== "string" || !/^[0-9a-f]{64}$/.test(body.inviteToken)) {
      return json(request, { error: "Invitation link is invalid or revoked." }, 400);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is unavailable.");
    const secretKey = readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc("preview_channel_invite", { invite_token: body.inviteToken });
    return error || !data
      ? json(request, { error: "Invitation link is invalid or revoked." }, 404)
      : json(request, { invite: data });
  } catch {
    return json(request, { error: "Service is temporarily unavailable." }, 500);
  }
});
