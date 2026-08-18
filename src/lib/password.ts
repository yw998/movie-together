export function passwordChangeError(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
  locale: "zh-CN" | "en-US" = "zh-CN",
): string | null {
  if (!currentPassword) return locale === "zh-CN" ? "请输入当前密码。" : "Enter your current password.";
  if (newPassword.length < 8) return locale === "zh-CN" ? "新密码至少需要 8 位。" : "The new password must be at least 8 characters.";
  if (newPassword === currentPassword) return locale === "zh-CN" ? "新密码不能与当前密码相同。" : "The new password must differ from your current password.";
  if (newPassword !== confirmation) return locale === "zh-CN" ? "两次输入的新密码不一致。" : "The new passwords do not match.";
  return null;
}
