import type { Session, SupabaseClient } from "@supabase/supabase-js";

export type AccountAuthErrorCode =
  | "captcha_required"
  | "invalid_credentials"
  | "username_taken"
  | "weak_password"
  | "rate_limited"
  | "owned_channels"
  | "invalid_recovery"
  | "unavailable";

export class AccountAuthError extends Error {
  constructor(public code: AccountAuthErrorCode, message = code) {
    super(message);
  }
}

type AuthResponse = {
  accessToken?: string;
  refreshToken?: string;
  recoveryCode?: string;
  error?: AccountAuthErrorCode;
};

async function invoke(client: SupabaseClient, body: Record<string, unknown>): Promise<AuthResponse> {
  const { data, error } = await client.functions.invoke("account-auth", { body });
  if (error) throw new AccountAuthError("unavailable");
  const response = (data ?? {}) as AuthResponse;
  if (response.error) throw new AccountAuthError(response.error);
  return response;
}

async function installSession(client: SupabaseClient, response: AuthResponse): Promise<Session> {
  if (!response.accessToken || !response.refreshToken) throw new AccountAuthError("unavailable");
  const { data, error } = await client.auth.setSession({
    access_token: response.accessToken,
    refresh_token: response.refreshToken,
  });
  if (error || !data.session) throw new AccountAuthError("unavailable");
  return data.session;
}

export async function loginWithUsername(
  client: SupabaseClient,
  username: string,
  password: string,
  captchaToken?: string,
): Promise<{ session: Session; recoveryCode: string | null }> {
  const response = await invoke(client, { action: "login", username, password, captchaToken });
  return {
    session: await installSession(client, response),
    recoveryCode: response.recoveryCode ?? null,
  };
}

export async function createUsernameAccount(
  client: SupabaseClient,
  username: string,
  password: string,
  captchaToken?: string,
): Promise<{ session: Session; recoveryCode: string }> {
  const response = await invoke(client, { action: "signup", username, password, captchaToken });
  if (!response.recoveryCode) throw new AccountAuthError("unavailable");
  return {
    session: await installSession(client, response),
    recoveryCode: response.recoveryCode,
  };
}

export async function recoverUsernameAccount(
  client: SupabaseClient,
  username: string,
  recoveryCode: string,
  password: string,
  captchaToken?: string,
): Promise<{ session: Session; recoveryCode: string }> {
  const response = await invoke(client, { action: "recover", username, recoveryCode, password, captchaToken });
  if (!response.recoveryCode) throw new AccountAuthError("unavailable");
  return {
    session: await installSession(client, response),
    recoveryCode: response.recoveryCode,
  };
}

export async function rotateRecoveryCode(client: SupabaseClient): Promise<string> {
  const response = await invoke(client, { action: "rotate_recovery" });
  if (!response.recoveryCode) throw new AccountAuthError("unavailable");
  return response.recoveryCode;
}

export async function changeUsernamePassword(
  client: SupabaseClient,
  currentPassword: string,
  newPassword: string,
  captchaToken?: string,
): Promise<void> {
  await invoke(client, { action: "change_password", currentPassword, newPassword, captchaToken });
}

export async function deleteUsernameAccount(
  client: SupabaseClient,
  username: string,
  password: string,
  captchaToken?: string,
): Promise<void> {
  await invoke(client, { action: "delete", username, password, captchaToken });
}
