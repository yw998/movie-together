import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";
import { calendarWeekFor } from "../lib/calendar-week";
import { useTransientMessage } from "../lib/useTransientMessage";

type WatchMarkRow = { id: string; window_start: string; showing_id: string };
export const WATCH_MARKS_CHANGED_EVENT = "movie-together:watch-marks-changed";
export type WatchMarkToggleResult =
  | { action: "created"; markId: string }
  | { action: "removed" }
  | null;

export function showingMarkKey(windowStart: string, showingId: string): string {
  return `${windowStart}:${showingId}`;
}

export function showingStorageWindow(localDate: string): string {
  return calendarWeekFor(localDate).start;
}

export function useWatchMarks(showings: readonly { id: string; localDate: string }[]) {
  const { user } = useAuth();
  const [marks, setMarks] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [shareCounts, setShareCounts] = useState<Map<string, number>>(new Map());
  const [mutualCounts, setMutualCounts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useTransientMessage();
  const showingWindows = useMemo(() => new Map(showings.map((showing) => [
    showing.id,
    showingStorageWindow(showing.localDate),
  ])), [showings]);
  const windowStarts = useMemo(() => [...new Set(showingWindows.values())].sort(), [showingWindows]);
  const windowSignature = windowStarts.join(",");

  const keyFor = useCallback((showingId: string) => {
    const windowStart = showingWindows.get(showingId);
    return windowStart ? showingMarkKey(windowStart, showingId) : null;
  }, [showingWindows]);

  useEffect(() => {
    const client = supabase;
    if (!client || !user || windowStarts.length === 0) {
      setMarks(new Map());
      setShareCounts(new Map());
      setError(null);
      return;
    }
    let active = true;
    void client
      .from("watch_marks")
      .select("id,window_start,showing_id")
      .in("window_start", windowStarts)
      .then(async ({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setError("无法读取想看标记，请刷新后重试。");
          return;
        }
        const rows = data as WatchMarkRow[];
        setMarks(new Map(rows.map((row) => [
          showingMarkKey(row.window_start, row.showing_id),
          row.id,
        ])));
        if (rows.length > 0) {
          const { data: shares } = await client
            .from("channel_mark_shares")
            .select("mark_id")
            .in("mark_id", rows.map((row) => row.id));
          const counts = new Map<string, number>();
          for (const share of shares ?? []) counts.set(share.mark_id, (counts.get(share.mark_id) ?? 0) + 1);
          if (active) setShareCounts(counts);
        } else {
          setShareCounts(new Map());
        }
        setError(null);
      });
    return () => { active = false; };
  }, [user, windowSignature]);

  const loadMutualCounts = useCallback(async () => {
    const client = supabase;
    if (!client || !user) {
      setMutualCounts(new Map());
      return;
    }
    const { data: memberships, error: membershipError } = await client
      .from("channel_members")
      .select("channel_id")
      .eq("user_id", user.id);
    if (membershipError || !memberships?.length) {
      setMutualCounts(new Map());
      return;
    }
    const results = await Promise.all(memberships.map((membership) => client.rpc(
      "list_channel_shared_marks",
      { target_channel_id: membership.channel_id },
    )));
    const peopleByShowing = new Map<string, Set<string>>();
    for (const result of results) {
      if (result.error) continue;
      for (const mark of result.data ?? []) {
        if (mark.user_id === user.id || !windowStarts.includes(mark.window_start)) continue;
        const people = peopleByShowing.get(mark.showing_id) ?? new Set<string>();
        people.add(mark.user_id);
        peopleByShowing.set(mark.showing_id, people);
      }
    }
    setMutualCounts(new Map([...peopleByShowing].map(([showingId, people]) => [showingId, people.size])));
  }, [user, windowSignature]);

  useEffect(() => {
    void loadMutualCounts();
    window.addEventListener(WATCH_MARKS_CHANGED_EVENT, loadMutualCounts);
    return () => window.removeEventListener(WATCH_MARKS_CHANGED_EVENT, loadMutualCounts);
  }, [loadMutualCounts]);

  const toggle = useCallback(async (showingId: string): Promise<WatchMarkToggleResult> => {
    const client = supabase;
    if (!client || !user) {
      requestAccountDialog();
      return null;
    }
    const key = keyFor(showingId);
    const windowStart = showingWindows.get(showingId);
    if (!key || !windowStart) return null;
    if (busy.has(key)) return null;
    setBusy((current) => new Set(current).add(key));
    setError(null);
    const existingId = marks.get(key);
    let result: WatchMarkToggleResult = null;
    if (existingId) {
      const { error: deleteError } = await client.from("watch_marks").delete().eq("id", existingId);
      if (deleteError) setError("无法取消标记，请稍后重试。");
      else setMarks((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      if (!deleteError) setShareCounts((current) => {
        const next = new Map(current);
        next.delete(existingId);
        return next;
      });
      if (!deleteError) result = { action: "removed" };
      if (!deleteError) window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    } else {
      const { data, error: insertError } = await client.rpc("create_watch_mark_with_defaults", {
        target_window_start: windowStart,
        target_showing_id: showingId,
      });
      if (insertError) setError("无法保存标记，请稍后重试。");
      else {
        const markId = data as string;
        setMarks((current) => new Map(current).set(key, markId));
        const { count } = await client
          .from("channel_mark_shares")
          .select("mark_id", { count: "exact", head: true })
          .eq("mark_id", markId);
        setShareCounts((current) => new Map(current).set(markId, count ?? 0));
        result = { action: "created", markId };
        window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
      }
    }
    setBusy((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    return result;
  }, [busy, keyFor, marks, showingWindows, user]);

  const updateSharing = useCallback(async (markId: string, channelIds: string[]) => {
    const client = supabase;
    if (!client || !user) return false;
    const { error: shareError } = await client.rpc("set_watch_mark_channels", {
      target_mark_id: markId,
      target_channel_ids: channelIds,
    });
    if (shareError) {
      setError("无法更新 Channel 分享，请稍后重试。");
      return false;
    }
    setShareCounts((current) => new Map(current).set(markId, channelIds.length));
    window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    return true;
  }, [user]);

  const addToChannel = useCallback(async (showingId: string, channelId: string) => {
    const client = supabase;
    if (!client || !user) {
      requestAccountDialog();
      return false;
    }
    const key = keyFor(showingId);
    const windowStart = showingWindows.get(showingId);
    if (!key || !windowStart) return false;
    if (busy.has(key)) return false;
    setBusy((current) => new Set(current).add(key));
    setError(null);
    const { data, error: shareError } = await client.rpc("add_watch_mark_to_channel", {
      target_window_start: windowStart,
      target_showing_id: showingId,
      target_channel_id: channelId,
    });
    if (shareError) setError("无法把标记分享到这个 Channel，请稍后重试。");
    else {
      const markId = data as string;
      setMarks((current) => new Map(current).set(key, markId));
      setShareCounts((current) => new Map(current).set(markId, (current.get(markId) ?? 0) + 1));
      window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    }
    setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
    return !shareError;
  }, [busy, keyFor, marks, showingWindows, user]);

  const removeFromChannel = useCallback(async (showingId: string, channelId: string) => {
    const client = supabase;
    if (!client || !user) return false;
    const key = keyFor(showingId);
    if (!key) return false;
    const markId = marks.get(key);
    if (!markId || busy.has(key)) return false;
    setBusy((current) => new Set(current).add(key));
    setError(null);
    const { data: existingShares, error: queryError } = await client
      .from("channel_mark_shares")
      .select("channel_id")
      .eq("mark_id", markId);
    const channelIds = (existingShares ?? [])
      .map((share) => share.channel_id)
      .filter((existingChannelId) => existingChannelId !== channelId);
    const { error: shareError } = queryError ? { error: queryError } : await client.rpc("set_watch_mark_channels", {
      target_mark_id: markId,
      target_channel_ids: channelIds,
    });
    if (shareError) setError("无法从这个 Channel 取消分享，请稍后重试。");
    else {
      setShareCounts((current) => new Map(current).set(markId, channelIds.length));
      window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    }
    setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
    return !shareError;
  }, [busy, keyFor, marks, user]);

  return {
    error,
    markedCount: marks.size,
    signedIn: Boolean(user),
    isMarked: (showingId: string) => { const key = keyFor(showingId); return key ? marks.has(key) : false; },
    isBusy: (showingId: string) => { const key = keyFor(showingId); return key ? busy.has(key) : false; },
    markId: (showingId: string) => { const key = keyFor(showingId); return key ? marks.get(key) ?? null : null; },
    shareCount: (showingId: string) => {
      const key = keyFor(showingId);
      const markId = key ? marks.get(key) : null;
      return markId ? shareCounts.get(markId) ?? 0 : 0;
    },
    mutualCount: (showingId: string) => mutualCounts.get(showingId) ?? 0,
    toggle,
    updateSharing,
    addToChannel,
    removeFromChannel,
  };
}
