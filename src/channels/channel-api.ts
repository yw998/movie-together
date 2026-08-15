import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase";

export type Channel = {
  id: string;
  name: string;
  owner_user_id: string | null;
};

export type ChannelInvitation = {
  invitation_id: string;
  channel_id: string;
  channel_name: string;
  inviter_username: string;
  expires_at: string;
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
  expiresAt: string;
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

export async function callInvitationFunction<T>(
  client: SupabaseClient | null,
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<T> {
  const activeClient = client ?? supabase;
  if (!activeClient) throw new Error("Supabase is unavailable.");
  const { data, error } = await activeClient.functions.invoke("channel-invitations", {
    body,
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  });
  if (error) throw error;
  return data as T;
}
