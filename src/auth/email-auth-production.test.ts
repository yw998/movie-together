import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const accountPath = new URL("./AccountControl.tsx", import.meta.url);
const turnstilePath = new URL("./TurnstileWidget.tsx", import.meta.url);
const auditPath = new URL("../../scripts/auth/audit-email-config.mjs", import.meta.url);

describe("production account email safeguards", () => {
  it("uses the canonical redirect helper for every email action", async () => {
    const source = await readFile(accountPath, "utf8");
    expect(source).toContain("const redirectUrl = authRedirectUrl()");
    expect(source).toContain("emailRedirectTo: redirectUrl");
    expect(source).toContain("redirectTo: redirectUrl");
    expect(source).not.toContain("emailRedirectTo: window.location.origin");
    expect(source).not.toContain("redirectTo: window.location.origin");
  });

  it("passes CAPTCHA tokens to sign-up, sign-in, resend, and recovery", async () => {
    const [account, turnstile] = await Promise.all([
      readFile(accountPath, "utf8"),
      readFile(turnstilePath, "utf8"),
    ]);
    expect(account.match(/captchaToken:/g)?.length).toBeGreaterThanOrEqual(4);
    expect(account).toContain("<TurnstileWidget");
    expect(turnstile).toContain("challenges.cloudflare.com/turnstile");
    expect(turnstile).toContain('"expired-callback"');
  });

  it("applies an honest client-side cooldown to confirmation resends", async () => {
    const source = await readFile(accountPath, "utf8");
    expect(source).toContain("const RESEND_COOLDOWN_SECONDS = 60");
    expect(source).toContain("setResendCooldown(RESEND_COOLDOWN_SECONDS)");
    expect(source).not.toContain("7 分钟");
    expect(source).not.toContain("7 minutes");
  });

  it("keeps the live Auth audit read-only and excludes secret values from output", async () => {
    const source = await readFile(auditPath, "utf8");
    expect(source).not.toContain("method:");
    expect(source).not.toContain("smtp_pass");
    expect(source).toContain("customSmtpConfigured");
    expect(source).toContain("captchaEnabled");
  });

  it("stores reviewed bilingual templates without remote tracking resources", async () => {
    const templates = await Promise.all(["confirmation", "recovery", "email-change"].map((name) =>
      readFile(new URL(`../../supabase/email-templates/${name}.html`, import.meta.url), "utf8"),
    ));
    for (const template of templates) {
      expect(template).toContain("{{ .ConfirmationURL }}");
      expect(template).toContain("NYC MOVIE TOGETHER");
      expect(template).not.toMatch(/<img|https?:\/\/(?!\{\{)/i);
    }
  });
});
