import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const encryptionKey = process.env.ACCOUNT_MIGRATION_BACKUP_KEY?.trim();
const inputPath = resolve(process.argv[2] ?? "artifacts/private/unified-account-email-backup.enc.json");

if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
if (!encryptionKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
  throw new Error("ACCOUNT_MIGRATION_BACKUP_KEY must be the external key used for the cutover backup.");
}

const envelope = JSON.parse(await readFile(inputPath, "utf8"));
if (envelope.algorithm !== "aes-256-gcm") throw new Error("Unsupported backup format.");
const decipher = createDecipheriv(
  "aes-256-gcm",
  Buffer.from(encryptionKey, "hex"),
  Buffer.from(envelope.iv, "base64"),
);
decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
const plaintext = Buffer.concat([
  decipher.update(Buffer.from(envelope.ciphertext, "base64")),
  decipher.final(),
]);
const backup = JSON.parse(plaintext.toString("utf8"));
if (backup.projectUrl !== url || !Array.isArray(backup.users)) {
  throw new Error("The backup does not belong to this Supabase project.");
}

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
for (const row of backup.users) {
  if (!row.id || !row.previousEmail) throw new Error(`Backup row ${row.id ?? "unknown"} has no restorable email.`);
  const { error } = await admin.auth.admin.updateUserById(row.id, {
    email: row.previousEmail,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not restore ${row.username}: ${error.message}`);
}

console.log(`Restored ${backup.users.length} account email identifiers from ${inputPath}.`);
