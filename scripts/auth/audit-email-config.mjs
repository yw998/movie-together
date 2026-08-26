const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const expectedSiteUrl = (
  process.env.PUBLIC_SITE_URL ?? process.env.VITE_PUBLIC_SITE_URL ?? "https://movie-together-nu.vercel.app"
).replace(/\/$/, "");
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required for the read-only Auth audit.");
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!response.ok) {
  throw new Error(`Supabase Auth audit failed (${response.status}). Refresh the local Management API token.`);
}
const config = await response.json();
const allowList = String(config.uri_allow_list ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const checks = {
  emailProviderEnabled: config.external_email_enabled === true,
  emailConfirmationRequired: config.mailer_autoconfirm === false,
  customSmtpConfigured: Boolean(config.smtp_host && config.smtp_admin_email),
  productionSiteUrl: String(config.site_url ?? "").replace(/\/$/, "") === expectedSiteUrl,
  productionRedirectAllowed: allowList.some((value) => value.replace(/\/$/, "") === expectedSiteUrl),
  captchaEnabled: config.security_captcha_enabled === true,
  captchaProviderConfigured: Boolean(config.security_captcha_provider),
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({ expectedSiteUrl, checks, failed }, null, 2));
if (process.argv.includes("--strict") && failed.length > 0) process.exitCode = 1;
