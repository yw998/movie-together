import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const encryptionKey = process.env.ACCOUNT_MIGRATION_BACKUP_KEY?.trim();
const outputPath = resolve(process.argv[2] ?? "artifacts/private/unified-account-email-backup.enc.json");

if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
if (!encryptionKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
  throw new Error("ACCOUNT_MIGRATION_BACKUP_KEY must be a 32-byte hexadecimal key stored outside the repository.");
}

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function listAllUsers() {
  const result = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    result.push(...data.users);
    if (data.users.length < 1000) return result;
  }
}
const users = await listAllUsers();
if (users.some((user) => user.email?.endsWith("@accounts.nyc-movie-together.invalid"))) {
  throw new Error("Internal account identifiers already exist. Roll back the prior attempt before rerunning this migration.");
}

const { data: profiles, error: profileError } = await admin.from("profiles").select("id,username");
if (profileError) throw profileError;
const usernameById = new Map(profiles.map((profile) => [profile.id, profile.username]));
const migrationRows = users.map((user) => {
  const username = usernameById.get(user.id);
  if (!username) throw new Error(`Auth user ${user.id} has no profile username.`);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error(`Invalid username for Auth user ${user.id}.`);
  return {
    id: user.id,
    username,
    previousEmail: user.email ?? null,
    internalEmail: `account-${randomBytes(32).toString("hex")}@accounts.nyc-movie-together.invalid`,
  };
});
if (new Set(migrationRows.map((row) => row.internalEmail)).size !== migrationRows.length) {
  throw new Error("Duplicate internal account identifiers detected; no changes were made.");
}

const backup = Buffer.from(JSON.stringify({
  createdAt: new Date().toISOString(),
  deleteBy: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  projectUrl: url,
  users: migrationRows,
}, null, 2));
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), iv);
const ciphertext = Buffer.concat([cipher.update(backup), cipher.final()]);
const tag = cipher.getAuthTag();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  algorithm: "aes-256-gcm",
  iv: iv.toString("base64"),
  tag: tag.toString("base64"),
  ciphertext: ciphertext.toString("base64"),
}, null, 2), { mode: 0o600 });

for (const row of migrationRows) {
  const { error } = await admin.auth.admin.updateUserById(row.id, {
    email: row.internalEmail,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not migrate ${row.username}: ${error.message}`);
  const { error: revokeError } = await admin.rpc("revoke_all_account_sessions", { target_user_id: row.id });
  if (revokeError) throw new Error(`Could not revoke sessions for ${row.username}: ${revokeError.message}`);
}

const after = await listAllUsers();
const migrated = new Map(after.map((user) => [user.id, user]));
for (const row of migrationRows) {
  const user = migrated.get(row.id);
  const identityEmails = (user?.identities ?? []).map((identity) => identity.identity_data?.email).filter(Boolean);
  if (user?.email !== row.internalEmail || identityEmails.some((email) => email !== row.internalEmail)) {
    throw new Error(`Round-trip verification failed for ${row.username}.`);
  }
}

console.log(`Migrated ${migrationRows.length} account email identifiers.`);
console.log(`Encrypted rollback backup: ${outputPath}`);
console.log("Delete the backup no later than 30 days after the production cutover.");
