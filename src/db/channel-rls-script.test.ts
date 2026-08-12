import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const scriptPath = new URL("../../scripts/db/test-channel-rls.ts", import.meta.url);

describe("live channel RLS verification", () => {
  it("tests multiple identities and always rolls back", async () => {
    const source = await readFile(scriptPath, "utf8");

    expect(source).toContain("set local role authenticated");
    expect(source).toContain("request.jwt.claims");
    expect(source).toContain("Owner cannot read their channel.");
    expect(source).toContain("Outsider can read a private channel.");
    expect(source).toContain("throw rollbackMarker");
    expect(source).not.toContain("insert into auth.users");
  });
});
