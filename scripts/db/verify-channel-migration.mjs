import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const [result] = await sql.unsafe(`
    select
      (select count(*) from schema_migrations
        where id in (
          '015_invitation_share_existing_marks.sql',
          '016_channel_only_identities.sql'
        ))::int as migrations,
      (select count(*) from channel_guests where revoked_at is not null)::int as revoked_guests,
      to_regprocedure('public.create_channel_identity_owner(text,text,text)') is not null as identity_rpc,
      to_regprocedure('public.accept_channel_invitation(uuid,boolean)') is not null as share_rpc
  `);
  console.log(JSON.stringify(result));
  if (
    result.migrations !== 2 ||
    !result.identity_rpc ||
    !result.share_rpc
  ) {
    throw new Error("Channel migration verification failed.");
  }
} finally {
  await sql.end();
}
