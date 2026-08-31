import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const [mode, inputArgument, outputArgument, keyArgument] = process.argv.slice(2);
if (!['encrypt', 'decrypt'].includes(mode) || !inputArgument || !outputArgument || !keyArgument) {
  throw new Error("Usage: node cutover-backup-crypto.mjs encrypt|decrypt INPUT OUTPUT KEY_PATH");
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const keyPath = resolve(keyArgument);
const keyRelativeToRepository = relative(process.cwd(), keyPath);
if (!isAbsolute(keyPath) || (!keyRelativeToRepository.startsWith("..") && !isAbsolute(keyRelativeToRepository))) {
  throw new Error("The encryption key must be stored outside the repository.");
}

if (mode === "encrypt") {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = await readFile(inputPath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  await writeFile(keyPath, key.toString("hex"), { encoding: "utf8", flag: "wx", mode: 0o600 });
  await writeFile(outputPath, JSON.stringify({
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }), { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(`Encrypted backup written to ${outputPath}`);
} else {
  const [payloadText, keyText] = await Promise.all([readFile(inputPath, "utf8"), readFile(keyPath, "utf8")]);
  const payload = JSON.parse(payloadText);
  if (payload.algorithm !== "aes-256-gcm") throw new Error("Unsupported backup encryption format.");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyText.trim(), "hex"), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  await writeFile(outputPath, plaintext, { flag: "wx", mode: 0o600 });
  console.log(`Decrypted backup written to ${outputPath}`);
}
