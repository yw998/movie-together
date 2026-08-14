-- Make group ownership and identity upgrades match the pre-launch product rules.

alter table public.channel_invite_links
  drop constraint if exists channel_invite_links_created_by_fkey;
alter table public.channel_invite_links
  add constraint channel_invite_links_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.channel_invite_links
  drop constraint if exists channel_invite_links_created_by_identity_fkey;
alter table public.channel_invite_links
  add constraint channel_invite_links_created_by_identity_fkey
  foreign key (created_by_identity) references public.channel_identities(id) on delete set null;
alter table public.channel_invite_links
  drop constraint if exists channel_invite_links_one_creator_check;
alter table public.channel_invite_links
  add constraint channel_invite_links_at_most_one_creator_check
  check (num_nonnulls(created_by, created_by_identity) <= 1);

create or replace function public.rename_channel(target_channel_id uuid, new_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare normalized_name text := trim(new_name);
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the group owner can rename the group.' using errcode = 'insufficient_privilege';
  end if;
  if length(normalized_name) not between 1 and 80 then
    raise exception 'Group name must be between 1 and 80 characters.' using errcode = 'check_violation';
  end if;
  update public.channels set name = normalized_name where id = target_channel_id;
end;
$$;

create or replace function public.rename_channel_as_identity(session_token text, new_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare owner_identity_id uuid := public.authenticate_channel_identity(session_token);
declare target_channel_id uuid;
declare normalized_name text := trim(new_name);
begin
  select channel_id into target_channel_id from public.channel_identities
    where id = owner_identity_id and role = 'owner';
  if target_channel_id is null or length(normalized_name) not between 1 and 80 then return false; end if;
  update public.channels set name = normalized_name where id = target_channel_id;
  return true;
end;
$$;

create or replace function public.perform_channel_owner_transfer(
  target_channel_id uuid,
  target_kind text,
  target_participant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_kind = 'account' then
    if not exists (
      select 1 from public.channel_members
      where channel_id = target_channel_id and user_id = target_participant_id and role = 'member'
    ) then return false; end if;
  elsif target_kind = 'channel_only' then
    if not exists (
      select 1 from public.channel_identities
      where channel_id = target_channel_id and id = target_participant_id and role = 'member'
    ) then return false; end if;
  else
    return false;
  end if;

  update public.channel_members set role = 'member'
    where channel_id = target_channel_id and role = 'owner';
  update public.channel_identities set role = 'member'
    where channel_id = target_channel_id and role = 'owner';

  if target_kind = 'account' then
    update public.channel_members set role = 'owner'
      where channel_id = target_channel_id and user_id = target_participant_id;
    update public.channels set owner_user_id = target_participant_id, owner_identity_id = null
      where id = target_channel_id;
  else
    update public.channel_identities set role = 'owner'
      where channel_id = target_channel_id and id = target_participant_id;
    update public.channels set owner_user_id = null, owner_identity_id = target_participant_id,
      last_identity_activity_at = now()
      where id = target_channel_id;
  end if;
  return true;
end;
$$;

create or replace function public.transfer_channel_ownership(
  target_channel_id uuid,
  target_kind text,
  target_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the group owner can transfer ownership.' using errcode = 'insufficient_privilege';
  end if;
  if not public.perform_channel_owner_transfer(target_channel_id, target_kind, target_participant_id) then
    raise exception 'The selected member cannot become owner.' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.transfer_channel_ownership_as_identity(
  session_token text,
  target_kind text,
  target_participant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare owner_identity_id uuid := public.authenticate_channel_identity(session_token);
declare target_channel_id uuid;
begin
  select channel_id into target_channel_id from public.channel_identities
    where id = owner_identity_id and role = 'owner';
  if target_channel_id is null then return false; end if;
  return public.perform_channel_owner_transfer(target_channel_id, target_kind, target_participant_id);
end;
$$;

create or replace function public.remove_channel_participant_as_identity(
  session_token text,
  target_kind text,
  target_participant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare owner_identity_id uuid := public.authenticate_channel_identity(session_token);
declare target_channel_id uuid;
declare identity_row public.channel_identities%rowtype;
begin
  select channel_id into target_channel_id from public.channel_identities
    where id = owner_identity_id and role = 'owner';
  if target_channel_id is null then return false; end if;

  if target_kind = 'account' then
    delete from public.channel_members
      where channel_id = target_channel_id and user_id = target_participant_id and role = 'member';
    return found;
  elsif target_kind = 'channel_only' then
    select * into identity_row from public.channel_identities
      where channel_id = target_channel_id and id = target_participant_id and role = 'member' for update;
    if identity_row.id is null then return false; end if;
    insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name)
      values (identity_row.id, identity_row.channel_id, 'removed', identity_row.display_name);
    delete from public.channel_identities where id = identity_row.id;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.channel_identity_view(target_identity_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'identity', jsonb_build_object(
      'id', identities.id,
      'displayName', identities.display_name,
      'role', identities.role,
      'channelId', channels.id,
      'channelName', channels.name,
      'publicChannelId', channels.public_id
    ),
    'inviteLinks', case when identities.role = 'owner' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', links.id,
        'expiresAt', links.expires_at,
        'useCount', links.use_count,
        'maxUses', links.max_uses,
        'revokedAt', links.revoked_at
      ) order by links.created_at desc)
      from public.channel_invite_links links
      where links.channel_id = channels.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'members', coalesce((
      select jsonb_agg(member order by member->>'joinedAt')
      from (
        select jsonb_build_object(
          'id', 'user:' || members.user_id::text,
          'displayName', profiles.username,
          'role', members.role,
          'kind', 'account',
          'joinedAt', members.joined_at
        ) member
        from public.channel_members members
        join public.profiles on profiles.id = members.user_id
        where members.channel_id = channels.id
        union all
        select jsonb_build_object(
          'id', 'identity:' || peers.id::text,
          'displayName', peers.display_name,
          'role', peers.role,
          'kind', 'channel_only',
          'joinedAt', peers.created_at
        ) member
        from public.channel_identities peers
        where peers.channel_id = channels.id
      ) combined_members
    ), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(mark order by mark->>'createdAt')
      from (
        select jsonb_build_object(
          'id', 'user:' || marks.user_id::text,
          'displayName', profiles.username,
          'kind', 'account',
          'windowStart', marks.window_start,
          'showingId', marks.showing_id,
          'createdAt', shares.created_at
        ) mark
        from public.channel_mark_shares shares
        join public.watch_marks marks on marks.id = shares.mark_id
        join public.profiles on profiles.id = marks.user_id
        where shares.channel_id = channels.id
        union all
        select jsonb_build_object(
          'id', 'identity:' || marks.identity_id::text,
          'displayName', peers.display_name,
          'kind', 'channel_only',
          'windowStart', marks.window_start,
          'showingId', marks.showing_id,
          'createdAt', marks.created_at
        ) mark
        from public.channel_identity_marks marks
        join public.channel_identities peers on peers.id = marks.identity_id
        where marks.channel_id = channels.id
      ) combined_marks
    ), '[]'::jsonb)
  )
  from public.channel_identities identities
  join public.channels on channels.id = identities.channel_id
  where identities.id = target_identity_id
$$;

create or replace function public.merge_channel_identity_into_account(
  session_token text,
  target_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
declare identity_row public.channel_identities%rowtype;
begin
  if target_user_id is null or not exists (select 1 from auth.users where id = target_user_id) then return null; end if;
  select * into identity_row from public.channel_identities where id = target_identity_id for update;
  if identity_row.id is null then return null; end if;

  if identity_row.role = 'owner' then
    update public.channel_members set role = 'member'
      where channel_id = identity_row.channel_id and role = 'owner' and user_id <> target_user_id;
    insert into public.channel_members(channel_id, user_id, role)
      values (identity_row.channel_id, target_user_id, 'owner')
      on conflict (channel_id, user_id) do update set role = 'owner';
    update public.channels set owner_user_id = target_user_id, owner_identity_id = null,
      last_identity_activity_at = now() where id = identity_row.channel_id;
  else
    insert into public.channel_members(channel_id, user_id, role)
      values (identity_row.channel_id, target_user_id, 'member')
      on conflict (channel_id, user_id) do nothing;
  end if;

  insert into public.watch_marks(user_id, window_start, showing_id, created_at)
    select target_user_id, window_start, showing_id, created_at
    from public.channel_identity_marks where identity_id = identity_row.id
    on conflict (user_id, window_start, showing_id) do update
      set created_at = least(public.watch_marks.created_at, excluded.created_at);

  insert into public.channel_mark_shares(channel_id, mark_id, shared_by, created_at)
    select identity_row.channel_id, marks.id, target_user_id, old_marks.created_at
    from public.watch_marks marks
    join public.channel_identity_marks old_marks
      on old_marks.window_start = marks.window_start and old_marks.showing_id = marks.showing_id
    where old_marks.identity_id = identity_row.id and marks.user_id = target_user_id
    on conflict (channel_id, mark_id) do update
      set created_at = least(public.channel_mark_shares.created_at, excluded.created_at);

  update public.channel_invite_links
    set created_by = target_user_id, created_by_identity = null
    where created_by_identity = identity_row.id;
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name, target_user_id)
    values (identity_row.id, identity_row.channel_id, 'merged', identity_row.display_name, target_user_id);
  delete from public.channel_identities where id = identity_row.id;
  return identity_row.channel_id;
end;
$$;

create or replace function public.cleanup_inactive_channel_identity_channels()
returns integer
language sql
security definer
set search_path = ''
as $$ select 0 $$;

do $$
declare cleanup_job_exists boolean := false;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute 'select exists (select 1 from cron.job where jobname = $1)'
      into cleanup_job_exists using 'cleanup-channel-only-identities';
  end if;
  if cleanup_job_exists then
    execute 'select cron.unschedule($1)' using 'cleanup-channel-only-identities';
  end if;
end;
$$;

revoke all on function public.rename_channel(uuid, text) from public, anon;
revoke all on function public.rename_channel_as_identity(text, text) from public, anon, authenticated;
revoke all on function public.perform_channel_owner_transfer(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.transfer_channel_ownership(uuid, text, uuid) from public, anon;
revoke all on function public.transfer_channel_ownership_as_identity(text, text, uuid) from public, anon, authenticated;
revoke all on function public.remove_channel_participant_as_identity(text, text, uuid) from public, anon, authenticated;

grant execute on function public.rename_channel(uuid, text) to authenticated;
grant execute on function public.rename_channel_as_identity(text, text) to service_role;
grant execute on function public.perform_channel_owner_transfer(uuid, text, uuid) to service_role;
grant execute on function public.transfer_channel_ownership(uuid, text, uuid) to authenticated;
grant execute on function public.transfer_channel_ownership_as_identity(text, text, uuid) to service_role;
grant execute on function public.remove_channel_participant_as_identity(text, text, uuid) to service_role;
