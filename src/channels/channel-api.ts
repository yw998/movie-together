import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase";
import type { Locale } from "../i18n/locales";

export type Channel = {
  id: string;
  name: string;
  owner_user_id: string;
};

export type ChannelNotification = {
  channel_id: string;
  channel_name: string;
  window_start: string;
  showing_id: string;
  actor_names: string[];
  actor_count: number;
  shared_at: string;
  is_new: boolean;
};

export type InvitePreview = {
  channelId: string;
  channelName: string;
  memberCount: number;
};

export const CHANNELS_CHANGED_EVENT = "movie-together:channels-changed";

export function notifyChannelsChanged() {
  window.dispatchEvent(new Event(CHANNELS_CHANGED_EVENT));
}

export function readInviteToken(): string | null {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = parameters.get("invite");
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export function clearInviteToken() {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  parameters.delete("invite");
  const hash = parameters.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`);
}

export function invitationUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#invite=${token}`;
}

export function invitationMessage({
  channelName,
  inviterUsername,
  locale,
  url,
}: {
  channelName: string;
  inviterUsername: string;
  locale: Locale;
  url: string;
}): string {
  const invitation = locale === "zh-CN"
    ? `@${inviterUsername} 邀请你加入「${channelName}」观影小组`
    : `@${inviterUsername} invited you to join the “${channelName}” Film Fam`;
  return `${invitation}\n${url}`;
}

export async function callInvitationFunction<T>(
  client: SupabaseClient | null,
  body: Record<string, unknown>,
): Promise<T> {
  const activeClient = client ?? supabase;
  if (!activeClient) throw new Error("Supabase is unavailable.");
  const { data, error } = await activeClient.functions.invoke("channel-invitations", { body });
  if (error) throw error;
  return data as T;
}
