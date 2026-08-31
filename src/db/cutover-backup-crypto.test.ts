import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../../scripts/db/cutover-backup-crypto.mjs", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("cutover backup encryption", () => {
  it("round-trips an encrypted backup with an external key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "movie-together-cutover-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "input.dump");
    const encrypted = join(directory, "backup.enc.json");
    const decrypted = join(directory, "output.dump");
    const key = join(directory, "backup.key");
    const payload = Buffer.from("restorable database payload\0with binary bytes", "utf8");
    await writeFile(input, payload);

    await execFileAsync(process.execPath, [scriptPath, "encrypt", input, encrypted, key]);
    await execFileAsync(process.execPath, [scriptPath, "decrypt", encrypted, decrypted, key]);

    expect(await readFile(decrypted)).toEqual(payload);
    expect((await readFile(key, "utf8")).trim()).toMatch(/^[0-9a-f]{64}$/);
  });
});
