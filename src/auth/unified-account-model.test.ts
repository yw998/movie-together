import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const controlPath = new URL("./AccountControl.tsx", import.meta.url);
const apiPath = new URL("./account-api.ts", import.meta.url);
const edgePath = new URL("../../supabase/functions/account-auth/index.ts", import.meta.url);

describe("unified username accounts", () => {
  it("uses username and password without collecting an email", async () => {
    const [control, api] = await Promise.all([readFile(controlPath, "utf8"), readFile(apiPath, "utf8")]);
    expect(control).toContain('name="username"');
    expect(control).toContain('name="password"');
    expect(control).toContain('name="password_confirmation"');
    expect(control).not.toContain('name="email"');
    expect(api).toContain('functions.invoke("account-auth"');
  });

  it("requires explicit username and password confirmation before deletion", async () => {
    const control = await readFile(controlPath, "utf8");
    expect(control).toContain('mode === "delete_account" ? copy("输入用户名确认"');
    expect(control).toContain("if (requestedUsername !== username)");
    expect(control).toContain("deleteUsernameAccount(activeClient, requestedUsername, password, captchaToken ?? undefined)");
    expect(control).not.toContain('readOnly={mode === "delete_account"}');
  });

  it("shows recovery codes once and supports copy and download", async () => {
    const control = await readFile(controlPath, "utf8");
    expect(control).toContain('setMode("recovery_receipt")');
    expect(control).toContain("navigator.clipboard.writeText(recoveryCode)");
    expect(control).toContain("I saved the recovery code");
    expect(control).toContain("recoveryUsername");
    expect(control).toContain('if (mode === "recovery_receipt") event.preventDefault()');
  });

  it("keeps internal identifiers and secrets behind the Edge Function", async () => {
    const edge = await readFile(edgePath, "utf8");
    expect(edge).toContain("@accounts.nyc-movie-together.invalid");
    expect(edge).toContain('readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")');
    expect(edge).toContain('action === "recover"');
    expect(edge).toContain('action === "rotate_recovery"');
    expect(edge).toContain('action === "change_password"');
    expect(edge).toContain('validPassword(body.newPassword, currentUsername)');
    expect(edge).toContain('requested_action: "change_password"');
    expect(edge).toContain('requested_action: "delete"');
    expect(edge).toContain('admin.auth.admin.signOut(accessToken, "others")');
    expect(edge).not.toContain("console.log");
  });
});
