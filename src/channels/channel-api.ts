import type { SupabaseClient } from "@supabase/supabase-js";

export type Channel = {
  id: string;
  name: string;
  owner_user_id: string;
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
  mark_id: string;
  window_start: string;
  showing_id: string;
  actor_username: string;
  shared_at: string;
  is_new: boolean;
};

export type InvitePreview = {
  channelId: string;
  channelName: string;
  expiresAt: string;
};

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
  client: SupabaseClient,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke("channel-invitations", { body });
  if (error) throw error;
  return data as T;
}
