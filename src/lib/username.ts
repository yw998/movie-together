export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function usernameError(value: string): string | null {
  const normalized = normalizeUsername(value);
  if (!normalized) return "请输入 username。";
  if (!USERNAME_PATTERN.test(normalized)) {
    return "username 需为 3–24 位小写字母、数字或下划线。";
  }
  return null;
}
