import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../auth/supabase";
import { messages, type MessageKey } from "./messages";
import { ENGLISH_UI_ENABLED, LOCALE_STORAGE_KEY, initialLocale, isLocale, type Locale } from "./locales";

type Variables = Record<string, string | number>;

type I18nState = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, variables?: Variables) => string;
  copy: (zh: string, en: string) => string;
};

const I18nContext = createContext<I18nState | null>(null);

function interpolate(message: string, variables?: Variables): string {
  if (!variables) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, preferredLocale } = useAuth();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const hasManualPreference = useRef(isLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY)));

  useEffect(() => {
    if (!ENGLISH_UI_ENABLED || hasManualPreference.current || !isLocale(preferredLocale)) return;
    setLocaleState(preferredLocale);
  }, [preferredLocale]);

  const persistAccountPreference = useCallback(async (nextLocale: Locale) => {
    if (!user || !supabase) return;
    const { error } = await supabase.from("profiles").update({ preferred_locale: nextLocale }).eq("id", user.id);
    if (error) console.error("Unable to save locale preference", error);
  }, [user]);

  useEffect(() => {
    if (ENGLISH_UI_ENABLED && user && hasManualPreference.current) void persistAccountPreference(locale);
  }, [locale, persistAccountPreference, user]);

  const setLocale = useCallback((nextLocale: Locale) => {
    if (!ENGLISH_UI_ENABLED) return;
    hasManualPreference.current = true;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
    void persistAccountPreference(nextLocale);
  }, [persistAccountPreference]);

  const t = useCallback((key: MessageKey, variables?: Variables) =>
    interpolate(messages[locale][key], variables), [locale]);
  const copy = useCallback((zh: string, en: string) => locale === "zh-CN" ? zh : en, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("meta.title");
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  }, [locale, t]);

  const value = useMemo(() => ({ locale, setLocale, t, copy }), [copy, locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
