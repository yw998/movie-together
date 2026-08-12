export function passwordChangeError(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): string | null {
  if (!currentPassword) return "请输入当前密码。";
  if (newPassword.length < 8) return "新密码至少需要 8 位。";
  if (newPassword === currentPassword) return "新密码不能与当前密码相同。";
  if (newPassword !== confirmation) return "两次输入的新密码不一致。";
  return null;
}
