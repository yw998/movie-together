import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const functionPath = new URL("../../supabase/functions/channel-invitations/index.ts", import.meta.url);

describe("channel Edge Function CORS", () => {
  it("allows changing localhost development ports without widening online origins", async () => {
    const source = await readFile(functionPath, "utf8");

    expect(source).toContain('url.hostname === "localhost"');
    expect(source).toContain('url.hostname === "127.0.0.1"');
    expect(source).toContain('url.protocol === "http:"');
    expect(source).toContain('"https://movie-together-nu.vercel.app"');
    expect(source).not.toContain('"http://localhost:5173"');
  });
});
