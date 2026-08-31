import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: "require" });

async function tableCount(qualifiedName, where = "") {
  const [{ exists }] = await sql.unsafe("select to_regclass($1) is not null as exists", [qualifiedName]);
  if (!exists) return null;
  const [{ count }] = await sql.unsafe(`select count(*)::int as count from ${qualifiedName}${where}`);
  return count;
}

async function managementReadiness() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!accessToken || !projectRef) return { configured: false, authorized: false };
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/backups`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { configured: true, authorized: false, status: response.status };
  const result = await response.json();
  return {
    configured: true,
    authorized: true,
    pitrEnabled: result.pitr_enabled === true,
    completedBackups: Array.isArray(result.backups)
      ? result.backups.filter((backup) => backup.status === "COMPLETED").length
      : 0,
  };
}

try {
  const [migration] = await sql.unsafe(`
    select exists (
      select 1 from public.schema_migrations
      where id = '023_unified_username_accounts.sql'
    ) as applied
  `);
  const result = {
    migration023Applied: migration.applied,
    legacyIdentities: await tableCount("public.channel_identities"),
    identityOwnedGroups: migration.applied
      ? null
      : await tableCount("public.channels", " where owner_identity_id is not null"),
    accountOwnedGroups: await tableCount("public.channels", " where owner_user_id is not null"),
    authUsers: await tableCount("auth.users"),
    internalAuthIdentifiers: await tableCount(
      "auth.users",
      " where email like '%@accounts.nyc-movie-together.invalid'",
    ),
    externalAuthIdentifiers: await tableCount(
      "auth.users",
      " where email is null or email not like '%@accounts.nyc-movie-together.invalid'",
    ),
    identityEmailMismatches: await tableCount(
      "auth.identities",
      " where coalesce(identity_data ->> 'email', '') not like '%@accounts.nyc-movie-together.invalid'",
    ),
    profiles: await tableCount("public.profiles"),
    activeRefreshSessions: await tableCount("auth.sessions"),
    recoveryCredentials: await tableCount("public.account_recovery_credentials"),
    management: await managementReadiness(),
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
