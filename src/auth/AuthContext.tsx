import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Locale } from "../i18n/locales";

type AuthState = {
  loading: boolean;
  user: User | null;
  username: string | null;
  preferredLocale: Locale | null;
};

const AuthContext = createContext<AuthState>({ loading: true, user: null, username: null, preferredLocale: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [preferredLocale, setPreferredLocale] = useState<Locale | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    const load = async (nextUser: User | null) => {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setUsername(null);
        setPreferredLocale(null);
        setLoading(false);
        return;
      }
      const { data } = await client
        .from("profiles")
        .select("username, preferred_locale")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (active) {
        setUsername(data?.username ?? null);
        setPreferredLocale(data?.preferred_locale === "zh-CN" || data?.preferred_locale === "en-US" ? data.preferred_locale : null);
        setLoading(false);
      }
    };
    void client.auth.getUser().then(({ data }) => load(data.user));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      void load(session?.user ?? null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ loading, user, username, preferredLocale }), [loading, user, username, preferredLocale]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
