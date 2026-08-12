import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";

type WatchMarkRow = { id: string; window_start: string; showing_id: string };
export const WATCH_MARKS_CHANGED_EVENT = "movie-together:watch-marks-changed";
export type WatchMarkToggleResult =
  | { action: "created"; markId: string }
  | { action: "removed" }
  | null;

export function showingMarkKey(windowStart: string, showingId: string): string {
  return `${windowStart}:${showingId}`;
}

export function useWatchMarks(windowStart: string) {
  const { user } = useAuth();
  const [marks, setMarks] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [shareCounts, setShareCounts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client || !user) {
      setMarks(new Map());
      setShareCounts(new Map());
      setError(null);
      return;
    }
    let active = true;
    void client
      .from("watch_marks")
      .select("id,window_start,showing_id")
      .eq("window_start", windowStart)
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
  }, [user, windowStart]);

  const toggle = useCallback(async (showingId: string): Promise<WatchMarkToggleResult> => {
    const client = supabase;
    if (!client || !user) {
      requestAccountDialog();
      return null;
    }
    const key = showingMarkKey(windowStart, showingId);
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
  }, [busy, marks, user, windowStart]);

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
    const key = showingMarkKey(windowStart, showingId);
    if (busy.has(key)) return false;
    setBusy((current) => new Set(current).add(key));
    setError(null);
    let markId = marks.get(key) ?? null;
    if (!markId) {
      const { data, error: insertError } = await client.rpc("create_watch_mark_with_defaults", {
        target_window_start: windowStart,
        target_showing_id: showingId,
      });
      if (insertError) {
        setError("无法保存标记，请稍后重试。");
        setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
        return false;
      }
      markId = data as string;
      setMarks((current) => new Map(current).set(key, markId!));
    }
    const { data: existingShares, error: queryError } = await client
      .from("channel_mark_shares")
      .select("channel_id")
      .eq("mark_id", markId);
    const channelIds = [...new Set([...(existingShares ?? []).map((share) => share.channel_id), channelId])];
    const { error: shareError } = queryError ? { error: queryError } : await client.rpc("set_watch_mark_channels", {
      target_mark_id: markId,
      target_channel_ids: channelIds,
    });
    if (shareError) setError("无法把标记分享到这个 Channel，请稍后重试。");
    else {
      setShareCounts((current) => new Map(current).set(markId!, channelIds.length));
      window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    }
    setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
    return !shareError;
  }, [busy, marks, user, windowStart]);

  const removeFromChannel = useCallback(async (showingId: string, channelId: string) => {
    const client = supabase;
    if (!client || !user) return false;
    const key = showingMarkKey(windowStart, showingId);
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
  }, [busy, marks, user, windowStart]);

  return {
    error,
    markedCount: marks.size,
    signedIn: Boolean(user),
    isMarked: (showingId: string) => marks.has(showingMarkKey(windowStart, showingId)),
    isBusy: (showingId: string) => busy.has(showingMarkKey(windowStart, showingId)),
    markId: (showingId: string) => marks.get(showingMarkKey(windowStart, showingId)) ?? null,
    shareCount: (showingId: string) => {
      const markId = marks.get(showingMarkKey(windowStart, showingId));
      return markId ? shareCounts.get(markId) ?? 0 : 0;
    },
    toggle,
    updateSharing,
    addToChannel,
    removeFromChannel,
  };
}
