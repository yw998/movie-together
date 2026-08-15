import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/019_account_summary.sql", import.meta.url);
const accountControlPath = new URL("../auth/AccountControl.tsx", import.meta.url);

describe("personal account summary", () => {
  it("counts distinct marked films and active group memberships privately", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("count(distinct showings.film_id)");
    expect(migration).toContain("from public.channel_members members");
    expect(migration).toContain("where marks.user_id = auth.uid()");
    expect(migration).toContain("where members.user_id = auth.uid()");
    expect(migration).toContain("security definer");
    expect(migration).toContain("grant execute on function get_my_account_summary() to authenticated");
    expect(migration).not.toContain("to anon");
  });

  it("opens the account destination on a summary with password change as an action", async () => {
    const account = await readFile(accountControlPath, "utf8");
    expect(account).toContain('user ? "account_summary" : "login"');
    expect(account).toContain('client.rpc("get_my_account_summary")');
    expect(account).toContain("已标记电影");
    expect(account).toContain("观影小组");
    expect(account).toContain("账号时长");
    expect(account).toContain('setMode("change_password")');
  });
});
