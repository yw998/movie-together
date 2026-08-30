import { createDatabaseClient } from "../../src/db/client";

const sql = createDatabaseClient();
try {
  const expectedTables = [
    "profiles", "watch_marks", "channels", "channel_members", "channel_invite_links",
    "channel_mark_shares", "channel_notification_reads", "account_recovery_credentials",
    "deleted_usernames", "account_auth_attempts",
  ];
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any(${expectedTables})
  `;
  const found = new Set(tables.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Missing account/group tables: ${missing.join(", ")}`);

  const removedObjects = [
    "channel_identities", "channel_identity_sessions", "channel_identity_marks",
    "channel_guests", "channel_invitations",
  ];
  const legacy = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any(${removedObjects})
  `;
  if (legacy.length) throw new Error(`Legacy identity tables still exist: ${legacy.map((row) => row.table_name).join(", ")}`);

  const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity from pg_class
    where oid in (
      'public.profiles'::regclass, 'public.watch_marks'::regclass,
      'public.channels'::regclass, 'public.channel_members'::regclass,
      'public.channel_invite_links'::regclass, 'public.channel_mark_shares'::regclass,
      'public.channel_notification_reads'::regclass,
      'public.account_recovery_credentials'::regclass,
      'public.deleted_usernames'::regclass, 'public.account_auth_attempts'::regclass
    )
  `;
  if (rls.length !== expectedTables.length || rls.some((row) => !row.relrowsecurity)) {
    throw new Error("RLS is not enabled on every active account/group table.");
  }

  const [rules] = await sql<{
    username_update: boolean;
    profile_insert: boolean;
    profile_delete: boolean;
    owner_nullable: boolean;
    auto_share: boolean;
    friend_id: boolean;
    invite_expiry: boolean;
    invite_max: boolean;
    invite_use_count: boolean;
  }[]>`
    select
      has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE') as username_update,
      has_table_privilege('authenticated', 'public.profiles', 'INSERT') as profile_insert,
      has_table_privilege('authenticated', 'public.profiles', 'DELETE') as profile_delete,
      (select is_nullable = 'YES' from information_schema.columns where table_schema='public' and table_name='channels' and column_name='owner_user_id') as owner_nullable,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='channel_members' and column_name='auto_share_new_marks') as auto_share,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='friend_id') as friend_id,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='channel_invite_links' and column_name='expires_at') as invite_expiry,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='channel_invite_links' and column_name='max_uses') as invite_max,
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='channel_invite_links' and column_name='use_count') as invite_use_count
  `;
  if (rules.username_update || rules.profile_insert || rules.profile_delete || rules.owner_nullable || rules.auto_share || rules.friend_id) {
    throw new Error("Immutable username or account-only group constraints are incomplete.");
  }
  if (rules.invite_expiry || rules.invite_max || rules.invite_use_count) {
    throw new Error("Legacy invitation expiry/use-limit columns still exist.");
  }

  const requiredFunctions = [
    "create_channel(text)", "create_channel_invite_link(uuid)", "preview_channel_invite(text)",
    "accept_channel_invite_link(text)", "create_watch_mark_with_defaults(date,text)",
    "set_watch_mark_channels(uuid,uuid[])", "list_channel_shared_marks(uuid)",
    "list_channel_participants(uuid)",
    "transfer_channel_ownership(uuid,uuid)", "list_my_channel_notifications()",
    "account_auth_guard(text,text,text)", "set_account_recovery_code(uuid,text)",
    "verify_account_recovery_code(text,text)", "revoke_all_account_sessions(uuid)",
  ];
  const functions = await sql<{ signature: string; exists: boolean }[]>`
    select signature, to_regprocedure('public.' || signature) is not null as exists
    from unnest(${requiredFunctions}::text[]) as signature
  `;
  const missingFunctions = functions.filter((row) => !row.exists).map((row) => row.signature);
  if (missingFunctions.length) {
    throw new Error(`Unified account/group functions are missing: ${missingFunctions.join(", ")}`);
  }

  const forbiddenFunctions = [
    "accept_channel_invite_link(text,boolean)", "create_channel_guest(text,text)",
    "invite_channel_user_by_friend_id(uuid,text)", "invite_channel_user_by_email(uuid,uuid,text)",
    "login_channel_identity(text,text,text)", "set_channel_auto_share(uuid,boolean)",
    "transfer_channel_ownership(uuid,text,uuid)",
  ];
  const legacyFunctions = await sql<{ signature: string; exists: boolean }[]>`
    select signature, to_regprocedure('public.' || signature) is not null as exists
    from unnest(${forbiddenFunctions}::text[]) as signature
  `;
  const remainingFunctions = legacyFunctions.filter((row) => row.exists).map((row) => row.signature);
  if (remainingFunctions.length) {
    throw new Error(`Legacy account/group functions still exist: ${remainingFunctions.join(", ")}`);
  }

  console.log("Verified unified accounts, private marks, link-only groups, reminders, and RLS boundaries.");
} finally {
  await sql.end();
}
