export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-US";
export const LOCALE_STORAGE_KEY = "nyc-movie-together.locale";
export const ENGLISH_UI_ENABLED = __VERCEL_PREVIEW__ || import.meta.env.VITE_ENABLE_ENGLISH_UI === "true";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

export function browserLocale(languages = navigator.languages): Locale {
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : DEFAULT_LOCALE;
}

export function initialLocale(): Locale {
  if (!ENGLISH_UI_ENABLED) return "zh-CN";
  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isLocale(saved) ? saved : browserLocale();
}
