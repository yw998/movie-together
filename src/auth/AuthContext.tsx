import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AuthState = {
  loading: boolean;
  user: User | null;
  username: string | null;
};

const AuthContext = createContext<AuthState>({ loading: true, user: null, username: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);

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
        setLoading(false);
        return;
      }
      const { data } = await client
        .from("profiles")
        .select("username")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (active) {
        setUsername(data?.username ?? null);
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

  const value = useMemo(() => ({ loading, user, username }), [loading, user, username]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
