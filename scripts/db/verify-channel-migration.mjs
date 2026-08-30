import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const [result] = await sql`
    select
      exists (select 1 from schema_migrations where id = '023_unified_username_accounts.sql') as migration,
      to_regclass('public.channel_identities') is null as identities_removed,
      to_regclass('public.channel_invitations') is null as direct_invites_removed,
      to_regclass('public.account_recovery_credentials') is not null as recovery_ready,
      to_regprocedure('public.create_channel(text)') is not null as group_create_ready,
      to_regprocedure('public.accept_channel_invite_link(text)') is not null as link_join_ready
  `;
  if (!Object.values(result).every(Boolean)) throw new Error("Unified account/group migration verification failed.");
  console.log(JSON.stringify(result));
} finally {
  await sql.end();
}
