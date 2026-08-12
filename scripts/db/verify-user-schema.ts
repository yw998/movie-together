import { createDatabaseClient } from "../../src/db/client";

const sql = createDatabaseClient();
try {
  const [tables] = await sql<{ profiles: string | null; watch_marks: string | null }[]>`
    select
      to_regclass('public.profiles')::text as profiles,
      to_regclass('public.watch_marks')::text as watch_marks
  `;
  if (tables.profiles !== "profiles" || tables.watch_marks !== "watch_marks") {
    throw new Error("Expected profiles and watch_marks tables are missing.");
  }

  const [showingStatus] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'showings'
        and column_name = 'publication_status'
    ) as exists
  `;
  if (!showingStatus.exists) {
    throw new Error("showings.publication_status is missing.");
  }

  const [usernameColumn] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'username'
    ) as exists
  `;
  if (!usernameColumn.exists) {
    throw new Error("profiles.username is missing.");
  }

  const rlsRows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity
    from pg_class
    where oid in ('public.profiles'::regclass, 'public.watch_marks'::regclass)
  `;
  if (rlsRows.length !== 2 || rlsRows.some((row) => !row.relrowsecurity)) {
    throw new Error("RLS is not enabled on every user table.");
  }

  const policies = await sql<{ policyname: string }[]>`
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'watch_marks')
  `;
  const expectedPolicies = [
    "profiles_delete_own",
    "profiles_insert_own",
    "profiles_select_own",
    "profiles_update_own",
    "watch_marks_delete_own",
    "watch_marks_insert_own",
    "watch_marks_select_own",
  ];
  const actualPolicies = new Set(policies.map((row) => row.policyname));
  const missingPolicies = expectedPolicies.filter((policy) => !actualPolicies.has(policy));
  if (missingPolicies.length > 0) {
    throw new Error(`Missing RLS policies: ${missingPolicies.join(", ")}`);
  }

  const foreignKeys = await sql<{ definition: string }[]>`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.watch_marks'::regclass
      and contype = 'f'
  `;
  const hasShowingReference = foreignKeys.some((row) =>
    row.definition.includes("FOREIGN KEY (window_start, showing_id)") &&
    row.definition.includes("REFERENCES showings(window_start, id)"),
  );
  if (!hasShowingReference) {
    throw new Error("watch_marks does not reference one exact showing.");
  }

  const [signupTrigger] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from pg_trigger
      where tgrelid = 'auth.users'::regclass
        and tgname = 'auth_user_create_profile'
        and not tgisinternal
    ) as exists
  `;
  if (!signupTrigger.exists) {
    throw new Error("The private-email signup profile trigger is missing.");
  }

  const channelTables = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'channels',
        'channel_members',
        'channel_invitations',
        'channel_invite_links',
        'channel_guests'
      )
  `;
  if (channelTables.length !== 5) {
    throw new Error("Expected channel and invitation tables are missing.");
  }

  const channelRls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity
    from pg_class
    where oid in (
      'public.channels'::regclass,
      'public.channel_members'::regclass,
      'public.channel_invitations'::regclass,
      'public.channel_invite_links'::regclass,
      'public.channel_guests'::regclass
    )
  `;
  if (channelRls.length !== 5 || channelRls.some((row) => !row.relrowsecurity)) {
    throw new Error("RLS is not enabled on every channel table.");
  }

  const [inviteDefaults] = await sql<{ seven_days: boolean; twenty_uses: boolean }[]>`
    select
      column_default like '%7 days%' as seven_days,
      (
        select column_default like '20%'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'channel_invite_links'
          and column_name = 'max_uses'
      ) as twenty_uses
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'channel_invite_links'
      and column_name = 'expires_at'
  `;
  if (!inviteDefaults?.seven_days || !inviteDefaults.twenty_uses) {
    throw new Error("Invite links do not use the confirmed seven-day/20-use defaults.");
  }

  const [trustedEndpoints] = await sql<{ attempts: string | null; joins: string | null; function_count: number }[]>`
    select
      to_regclass('public.channel_guest_access_attempts')::text as attempts,
      to_regclass('public.channel_guest_join_attempts')::text as joins,
      (
        select count(*)::integer from pg_proc
        where oid in (
          'public.preview_channel_invite(text)'::regprocedure,
          'public.create_channel_guest_limited(text,text,text)'::regprocedure,
          'public.read_channel_as_guest(uuid,text)'::regprocedure,
          'public.invite_channel_user_by_email(uuid,uuid,text)'::regprocedure,
          'public.list_my_channel_invitations()'::regprocedure
        )
      ) as function_count
  `;
  if (
    trustedEndpoints.attempts !== "channel_guest_access_attempts" ||
    trustedEndpoints.joins !== "channel_guest_join_attempts" ||
    trustedEndpoints.function_count !== 5
  ) {
    throw new Error("Trusted guest/email endpoint database support is incomplete.");
  }

  const [invitationMethods] = await sql<{ friend_id_enabled: boolean; generic_disabled: boolean }[]>`
    select
      has_function_privilege(
        'authenticated',
        'public.invite_channel_user_by_friend_id(uuid,text)',
        'EXECUTE'
      ) as friend_id_enabled,
      not has_function_privilege(
        'authenticated',
        'public.invite_channel_user(uuid,text,text)',
        'EXECUTE'
      ) as generic_disabled
  `;
  if (!invitationMethods.friend_id_enabled || !invitationMethods.generic_disabled) {
    throw new Error("Registered-user invitations are not restricted to Friend ID/email.");
  }

  const [sharingSchema] = await sql<{ shares: string | null; auto_share: boolean; function_count: number }[]>`
    select
      to_regclass('public.channel_mark_shares')::text as shares,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'channel_members'
          and column_name = 'auto_share_new_marks'
      ) as auto_share,
      (
        select count(*)::integer from pg_proc
        where oid in (
          'public.create_watch_mark_with_defaults(date,text)'::regprocedure,
          'public.set_watch_mark_channels(uuid,uuid[])'::regprocedure,
          'public.set_channel_auto_share(uuid,boolean)'::regprocedure,
          'public.list_channel_shared_marks(uuid)'::regprocedure
        )
      ) as function_count
  `;
  if (sharingSchema.shares !== "channel_mark_shares" || !sharingSchema.auto_share || sharingSchema.function_count !== 4) {
    throw new Error("Channel watch-mark sharing schema is incomplete.");
  }

  console.log("Verified accounts, watch marks, channel invitations, defaults, and RLS policies.");
} finally {
  await sql.end();
}
