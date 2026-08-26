import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { callInvitationFunction, invitationUrl, type ChannelNotification } from "./channel-api";
import { supabase } from "../auth/supabase";
import { useI18n } from "../i18n/I18nContext";

const SESSION_KEY = "movie-together:channel-identity-session";
const CODE_KEY_PREFIX = "movie-together:channel-identity-code:";

export type ChannelIdentity = {
  id: string;
  displayName: string;
  role: "owner" | "member";
  channelId: string;
  channelName: string;
  publicChannelId: string;
};

export type ChannelIdentityMember = {
  id: string;
  displayName: string;
  role: "owner" | "member";
  kind: "account" | "channel_only";
  joinedAt: string;
};

export type ChannelIdentityMark = {
  id: string;
  displayName: string;
  kind: "account" | "channel_only";
  windowStart: string;
  showingId: string;
  createdAt: string;
};

type IdentityView = {
  identity: ChannelIdentity;
  members: ChannelIdentityMember[];
  marks: ChannelIdentityMark[];
  inviteLinks: { id: string; expiresAt: string; useCount: number; maxUses: number; revokedAt: string | null }[];
};

type IdentityResponse = {
  sessionToken: string;
  accessCode?: string;
  view: IdentityView;
};

type ChannelIdentityState = {
  loading: boolean;
  sessionToken: string | null;
  identity: ChannelIdentity | null;
  members: ChannelIdentityMember[];
  marks: ChannelIdentityMark[];
  inviteLinks: IdentityView["inviteLinks"];
  notifications: ChannelNotification[];
  notificationsLoading: boolean;
  unreadNotificationCount: number;
  savedCode: string | null;
  createChannel: (channelName: string, displayName: string) => Promise<string | null>;
  joinInvite: (inviteToken: string, displayName: string) => Promise<string | null>;
  login: (publicChannelId: string, accessCode: string) => Promise<string | null>;
  refresh: () => Promise<boolean>;
  refreshNotifications: () => Promise<boolean>;
  markNotificationsRead: () => Promise<boolean>;
  toggleMark: (showingId: string, storageWindowStart: string) => Promise<boolean>;
  rotateCode: () => Promise<string | null>;
  createInviteLink: () => Promise<string | null>;
  revokeInviteLink: (linkId: string) => Promise<boolean>;
  renameChannel: (name: string) => Promise<boolean>;
  transferOwnership: (kind: ChannelIdentityMember["kind"], participantId: string) => Promise<boolean>;
  removeMember: (kind: ChannelIdentityMember["kind"], participantId: string) => Promise<boolean>;
  leave: () => Promise<boolean>;
  deleteChannel: () => Promise<boolean>;
  logout: () => Promise<void>;
  mergeIntoAccount: () => Promise<string | null>;
  mergeCredentials: (publicChannelId: string, accessCode: string) => Promise<string | null>;
};

const emptyState: ChannelIdentityState = {
  loading: true,
  sessionToken: null,
  identity: null,
  members: [],
  marks: [],
  inviteLinks: [],
  notifications: [],
  notificationsLoading: false,
  unreadNotificationCount: 0,
  savedCode: null,
  createChannel: async () => null,
  joinInvite: async () => null,
  login: async () => null,
  refresh: async () => false,
  refreshNotifications: async () => false,
  markNotificationsRead: async () => false,
  toggleMark: async () => false,
  rotateCode: async () => null,
  createInviteLink: async () => null,
  revokeInviteLink: async () => false,
  renameChannel: async () => false,
  transferOwnership: async () => false,
  removeMember: async () => false,
  leave: async () => false,
  deleteChannel: async () => false,
  logout: async () => undefined,
  mergeIntoAccount: async () => null,
  mergeCredentials: async () => null,
};

const ChannelIdentityContext = createContext<ChannelIdentityState>(emptyState);

export function ChannelIdentityProvider({ children }: { children: ReactNode }) {
  const { copy } = useI18n();
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [view, setView] = useState<IdentityView | null>(null);
  const [notifications, setNotifications] = useState<ChannelNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  const acceptResponse = useCallback((response: IdentityResponse, suppliedCode?: string) => {
    localStorage.setItem(SESSION_KEY, response.sessionToken);
    setSessionToken(response.sessionToken);
    setView(response.view);
    const code = response.accessCode ?? suppliedCode;
    if (code) localStorage.setItem(`${CODE_KEY_PREFIX}${response.view.identity.publicChannelId}`, code.toUpperCase());
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSessionToken(null);
    setView(null);
    setNotifications([]);
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionToken) {
      setView(null);
      setLoading(false);
      return false;
    }
    try {
      const result = await callInvitationFunction<{ view: IdentityView }>(null, {
        action: "identity_session",
        sessionToken,
      });
      setView(result.view);
      setLoading(false);
      return true;
    } catch {
      clearSession();
      setLoading(false);
      return false;
    }
  }, [clearSession, sessionToken]);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshNotifications = useCallback(async () => {
    if (!sessionToken) {
      setNotifications([]);
      return false;
    }
    setNotificationsLoading(true);
    try {
      const result = await callInvitationFunction<{ notifications: ChannelNotification[] }>(null, {
        action: "identity_notifications",
        sessionToken,
      });
      setNotifications(result.notifications);
      setNotificationsLoading(false);
      return true;
    } catch {
      setNotificationsLoading(false);
      return false;
    }
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return;
    void refreshNotifications();
    const timer = window.setInterval(() => void refreshNotifications(), 60_000);
    const refreshOnFocus = () => void refreshNotifications();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refreshNotifications, sessionToken]);

  const markNotificationsRead = useCallback(async () => {
    if (!sessionToken) return false;
    try {
      await callInvitationFunction(null, { action: "identity_notifications_read", sessionToken });
      setNotifications((current) => current.map((notification) => ({ ...notification, is_new: false })));
      return true;
    } catch { return false; }
  }, [sessionToken]);

  const createChannel = useCallback(async (channelName: string, displayName: string) => {
    try {
      const result = await callInvitationFunction<IdentityResponse>(null, {
        action: "identity_create_channel", channelName, displayName,
      });
      acceptResponse(result);
      return result.accessCode ?? null;
    } catch { return null; }
  }, [acceptResponse]);

  const joinInvite = useCallback(async (inviteToken: string, displayName: string) => {
    try {
      const result = await callInvitationFunction<IdentityResponse>(null, {
        action: "identity_join", inviteToken, displayName,
      });
      acceptResponse(result);
      return result.accessCode ?? null;
    } catch { return null; }
  }, [acceptResponse]);

  const login = useCallback(async (publicChannelId: string, accessCode: string) => {
    try {
      const result = await callInvitationFunction<IdentityResponse>(null, {
        action: "identity_login", publicChannelId, accessCode,
      });
      acceptResponse(result, accessCode);
      return result.view.identity.channelId;
    } catch { return null; }
  }, [acceptResponse]);

  const toggleMark = useCallback(async (showingId: string, storageWindowStart: string) => {
    if (!sessionToken) return false;
    try {
      const result = await callInvitationFunction<{ view: IdentityView }>(null, {
        action: "identity_toggle_mark",
        sessionToken,
        windowStart: storageWindowStart,
        showingId,
      });
      setView(result.view);
      return true;
    } catch { return false; }
  }, [sessionToken]);

  const rotateCode = useCallback(async () => {
    if (!sessionToken) return null;
    try {
      const result = await callInvitationFunction<IdentityResponse>(null, {
        action: "identity_rotate_code", sessionToken,
      });
      acceptResponse(result);
      return result.accessCode ?? null;
    } catch { return null; }
  }, [acceptResponse, sessionToken]);

  const createInviteLink = useCallback(async () => {
    if (!sessionToken) return null;
    try {
      const result = await callInvitationFunction<{ link: { invite_token: string } }>(null, {
        action: "identity_create_link", sessionToken,
      });
      await refresh();
      return invitationUrl(result.link.invite_token);
    } catch { return null; }
  }, [refresh, sessionToken]);

  const revokeInviteLink = useCallback(async (linkId: string) => {
    if (!sessionToken) return false;
    try {
      await callInvitationFunction(null, { action: "identity_revoke_link", sessionToken, linkId });
      return refresh();
    } catch { return false; }
  }, [refresh, sessionToken]);

  const renameChannel = useCallback(async (name: string) => {
    if (!sessionToken) return false;
    try {
      await callInvitationFunction(null, { action: "identity_rename", sessionToken, name });
      return refresh();
    } catch { return false; }
  }, [refresh, sessionToken]);

  const transferOwnership = useCallback(async (kind: ChannelIdentityMember["kind"], participantId: string) => {
    if (!sessionToken) return false;
    try {
      await callInvitationFunction(null, {
        action: "identity_transfer_owner",
        sessionToken,
        participantKind: kind,
        participantId,
      });
      return refresh();
    } catch { return false; }
  }, [refresh, sessionToken]);

  const removeMember = useCallback(async (kind: ChannelIdentityMember["kind"], participantId: string) => {
    if (!sessionToken) return false;
    try {
      await callInvitationFunction(null, {
        action: "identity_remove_member",
        sessionToken,
        participantKind: kind,
        participantId,
      });
      return refresh();
    } catch { return false; }
  }, [refresh, sessionToken]);

  const endIdentity = useCallback(async (action: "identity_leave" | "identity_delete_channel") => {
    if (!sessionToken) return false;
    try {
      await callInvitationFunction(null, { action, sessionToken });
      clearSession();
      return true;
    } catch { return false; }
  }, [clearSession, sessionToken]);

  const logout = useCallback(async () => {
    if (sessionToken) {
      try { await callInvitationFunction(null, { action: "identity_logout", sessionToken }); } catch { /* local logout still succeeds */ }
    }
    clearSession();
  }, [clearSession, sessionToken]);

  const mergeIntoAccount = useCallback(async () => {
    if (!sessionToken || !supabase) return null;
    try {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      const accessToken = authData.session?.access_token;
      if (authError || !accessToken) return null;
      const result = await callInvitationFunction<{ channelId: string }>(null, {
        action: "identity_merge", sessionToken,
      }, accessToken);
      clearSession();
      return result.channelId;
    } catch { return null; }
  }, [clearSession, sessionToken]);

  const mergeCredentials = useCallback(async (publicChannelId: string, accessCode: string) => {
    try {
      const preview = await callInvitationFunction<IdentityResponse>(null, {
        action: "identity_login", publicChannelId, accessCode,
      });
      const markCount = preview.view.marks.filter((mark) => mark.id === `identity:${preview.view.identity.id}`).length;
      const accepted = window.confirm(copy(
        `确认把「${preview.view.identity.channelName}」中的${preview.view.identity.role === "owner" ? "组长" : "成员"}身份和 ${markCount} 个想看合并到当前个人账号吗？原个人代码将立即失效，此操作不可撤销。`,
        `Merge the ${preview.view.identity.role === "owner" ? "Organizer" : "Member"} profile and ${markCount} want-to-watch marks from “${preview.view.identity.channelName}” into the current personal account? The old personal code will stop working immediately, and this cannot be undone.`,
      ));
      if (!accepted) {
        await callInvitationFunction(null, { action: "identity_logout", sessionToken: preview.sessionToken });
        return null;
      }
      const result = await callInvitationFunction<{ channelId: string }>(null, {
        action: "identity_merge", sessionToken: preview.sessionToken,
      });
      return result.channelId;
    } catch { return null; }
  }, [copy]);

  const savedCode = view ? localStorage.getItem(`${CODE_KEY_PREFIX}${view.identity.publicChannelId}`) : null;
  const value = useMemo<ChannelIdentityState>(() => ({
    loading,
    sessionToken,
    identity: view?.identity ?? null,
    members: view?.members ?? [],
    marks: view?.marks ?? [],
    inviteLinks: view?.inviteLinks ?? [],
    notifications,
    notificationsLoading,
    unreadNotificationCount: notifications.filter((notification) => notification.is_new).length,
    savedCode,
    createChannel,
    joinInvite,
    login,
    refresh,
    refreshNotifications,
    markNotificationsRead,
    toggleMark,
    rotateCode,
    createInviteLink,
    revokeInviteLink,
    renameChannel,
    transferOwnership,
    removeMember,
    leave: () => endIdentity("identity_leave"),
    deleteChannel: () => endIdentity("identity_delete_channel"),
    logout,
    mergeIntoAccount,
    mergeCredentials,
  }), [createChannel, createInviteLink, endIdentity, joinInvite, loading, login, logout, markNotificationsRead, mergeCredentials, mergeIntoAccount, notifications, notificationsLoading, refresh, refreshNotifications, removeMember, renameChannel, revokeInviteLink, rotateCode, savedCode, sessionToken, toggleMark, transferOwnership, view]);

  return <ChannelIdentityContext.Provider value={value}>{children}</ChannelIdentityContext.Provider>;
}

export function useChannelIdentity() {
  return useContext(ChannelIdentityContext);
}
