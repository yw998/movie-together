import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";

type WatchMarkRow = { id: string; window_start: string; showing_id: string };

export function showingMarkKey(windowStart: string, showingId: string): string {
  return `${windowStart}:${showingId}`;
}

export function useWatchMarks(windowStart: string) {
  const { user } = useAuth();
  const [marks, setMarks] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client || !user) {
      setMarks(new Map());
      setError(null);
      return;
    }
    let active = true;
    void client
      .from("watch_marks")
      .select("id,window_start,showing_id")
      .eq("window_start", windowStart)
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setError("无法读取想看标记，请刷新后重试。");
          return;
        }
        setMarks(new Map((data as WatchMarkRow[]).map((row) => [
          showingMarkKey(row.window_start, row.showing_id),
          row.id,
        ])));
        setError(null);
      });
    return () => { active = false; };
  }, [user, windowStart]);

  const toggle = useCallback(async (showingId: string) => {
    const client = supabase;
    if (!client || !user) {
      requestAccountDialog();
      return;
    }
    const key = showingMarkKey(windowStart, showingId);
    if (busy.has(key)) return;
    setBusy((current) => new Set(current).add(key));
    setError(null);
    const existingId = marks.get(key);
    if (existingId) {
      const { error: deleteError } = await client.from("watch_marks").delete().eq("id", existingId);
      if (deleteError) setError("无法取消标记，请稍后重试。");
      else setMarks((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    } else {
      const { data, error: insertError } = await client
        .from("watch_marks")
        .insert({ window_start: windowStart, showing_id: showingId })
        .select("id,window_start,showing_id")
        .single();
      if (insertError) setError("无法保存标记，请稍后重试。");
      else {
        const row = data as WatchMarkRow;
        setMarks((current) => new Map(current).set(key, row.id));
      }
    }
    setBusy((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, [busy, marks, user, windowStart]);

  return {
    error,
    markedCount: marks.size,
    signedIn: Boolean(user),
    isMarked: (showingId: string) => marks.has(showingMarkKey(windowStart, showingId)),
    isBusy: (showingId: string) => busy.has(showingMarkKey(windowStart, showingId)),
    toggle,
  };
}
