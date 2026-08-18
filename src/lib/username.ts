export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function usernameError(value: string, locale: "zh-CN" | "en-US" = "zh-CN"): string | null {
  const normalized = normalizeUsername(value);
  if (!normalized) return locale === "zh-CN" ? "请输入 username。" : "Enter a username.";
  if (!USERNAME_PATTERN.test(normalized)) {
    return locale === "zh-CN" ? "username 需为 3–24 位小写字母、数字或下划线。" : "The username must be 3–24 lowercase letters, numbers, or underscores.";
  }
  return null;
}
