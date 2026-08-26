const DEFAULT_PRODUCTION_SITE_URL = "https://movie-together-nu.vercel.app";

function safeOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function authRedirectUrl(options: {
  configuredUrl?: string;
  currentOrigin?: string;
  production?: boolean;
} = {}): string {
  const configured = safeOrigin(options.configuredUrl ?? import.meta.env.VITE_PUBLIC_SITE_URL);
  if (configured) return configured;
  const production = options.production ?? import.meta.env.PROD;
  if (production) return DEFAULT_PRODUCTION_SITE_URL;
  return safeOrigin(options.currentOrigin ?? window.location.origin) ?? DEFAULT_PRODUCTION_SITE_URL;
}
