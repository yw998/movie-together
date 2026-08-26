import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { requestAccountDialog } from "../auth/account-events";
import { supabase } from "../auth/supabase";
import { useTransientMessage } from "../lib/useTransientMessage";
import { useI18n } from "../i18n/I18nContext";
import type { PublishedShowing } from "../types/schedule";

type WatchMarkRow = { id: string; showing_id: string };
export const WATCH_MARKS_CHANGED_EVENT = "movie-together:watch-marks-changed";
export type WatchMarkToggleResult =
  | { action: "created"; markId: string }
  | { action: "removed" }
  | null;

export function watchMarkRpcIdentity(showing: Pick<PublishedShowing, "id" | "storageWindowStart">) {
  return {
    target_window_start: showing.storageWindowStart,
    target_showing_id: showing.id,
  };
}

export function countMarkedShowings(
  markedShowingIds: Iterable<string>,
  showings: readonly { id: string }[],
): number {
  const visibleIds = new Set(showings.map((showing) => showing.id));
  return new Set([...markedShowingIds].filter((id) => visibleIds.has(id))).size;
}

export function useWatchMarks(showings: readonly Pick<PublishedShowing, "id" | "storageWindowStart">[]) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [marks, setMarks] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [shareCounts, setShareCounts] = useState<Map<string, number>>(new Map());
  const [mutualCounts, setMutualCounts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useTransientMessage();
  const showingWindows = useMemo(() => new Map(showings.map((showing) => [
    showing.id, showing.storageWindowStart,
  ])), [showings]);
  const showingIds = useMemo(() => [...showingWindows.keys()], [showingWindows]);
  const showingSignature = showingIds.join(",");

  const keyFor = useCallback((showingId: string) => showingWindows.has(showingId) ? showingId : null, [showingWindows]);

  useEffect(() => {
    const client = supabase;
    if (!client || !user || showingIds.length === 0) {
      setMarks(new Map());
      setShareCounts(new Map());
      setError(null);
      return;
    }
    let active = true;
    void client
      .from("watch_marks")
      .select("id,showing_id")
      .then(async ({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setError(t("marks.loadError"));
          return;
        }
        const rows = data as WatchMarkRow[];
        const visibleRows = rows.filter((row) => showingWindows.has(row.showing_id));
        setMarks(new Map(visibleRows.map((row) => [row.showing_id, row.id])));
        if (visibleRows.length > 0) {
          const { data: shares } = await client
            .from("channel_mark_shares")
            .select("mark_id")
            .in("mark_id", visibleRows.map((row) => row.id));
          const counts = new Map<string, number>();
          for (const share of shares ?? []) counts.set(share.mark_id, (counts.get(share.mark_id) ?? 0) + 1);
          if (active) setShareCounts(counts);
        } else {
          setShareCounts(new Map());
        }
        setError(null);
      });
    return () => { active = false; };
  }, [showingSignature, showingWindows, t, user]);

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
        if (mark.user_id === user.id || !showingWindows.has(mark.showing_id)) continue;
        const people = peopleByShowing.get(mark.showing_id) ?? new Set<string>();
        people.add(mark.user_id);
        peopleByShowing.set(mark.showing_id, people);
      }
    }
    setMutualCounts(new Map([...peopleByShowing].map(([showingId, people]) => [showingId, people.size])));
  }, [showingSignature, showingWindows, user]);

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
      if (deleteError) setError(t("marks.removeError"));
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
      const { data, error: insertError } = await client.rpc(
        "create_watch_mark_with_defaults",
        watchMarkRpcIdentity({ id: showingId, storageWindowStart: windowStart }),
      );
      if (insertError) setError(t("marks.saveError"));
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
  }, [busy, keyFor, marks, showingWindows, t, user]);

  const updateSharing = useCallback(async (markId: string, channelIds: string[]) => {
    const client = supabase;
    if (!client || !user) return false;
    const { error: shareError } = await client.rpc("set_watch_mark_channels", {
      target_mark_id: markId,
      target_channel_ids: channelIds,
    });
    if (shareError) {
      setError(t("marks.shareUpdateError"));
      return false;
    }
    setShareCounts((current) => new Map(current).set(markId, channelIds.length));
    window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    return true;
  }, [t, user]);

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
      ...watchMarkRpcIdentity({ id: showingId, storageWindowStart: windowStart }),
      target_channel_id: channelId,
    });
    if (shareError) setError(t("marks.shareFamError"));
    else {
      const markId = data as string;
      setMarks((current) => new Map(current).set(key, markId));
      setShareCounts((current) => new Map(current).set(markId, (current.get(markId) ?? 0) + 1));
      window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    }
    setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
    return !shareError;
  }, [busy, keyFor, showingWindows, t, user]);

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
    if (shareError) setError(t("marks.unshareFamError"));
    else {
      setShareCounts((current) => new Map(current).set(markId, channelIds.length));
      window.dispatchEvent(new Event(WATCH_MARKS_CHANGED_EVENT));
    }
    setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
    return !shareError;
  }, [busy, keyFor, marks, t, user]);

  return {
    error,
    markedCount: countMarkedShowings(marks.keys(), showings),
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
