-- Replace email-facing and Channel-only authentication with one username account model.
-- Deployment must run during the documented write pause, after an encrypted backup.

create table public.account_recovery_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  rotated_at timestamptz not null default now()
);

create table public.deleted_usernames (
  username text primary key check (username ~ '^[a-z0-9_]{3,24}$'),
  deleted_at timestamptz not null default now()
);

create table public.account_auth_attempts (
  id bigint generated always as identity primary key,
  fingerprint_hash bytea not null,
  username_hash bytea not null,
  action text not null check (action in ('login', 'signup', 'recover', 'change_password', 'delete')),
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index account_auth_attempts_fingerprint_recent_idx
  on public.account_auth_attempts(fingerprint_hash, action, attempted_at desc);
create index account_auth_attempts_username_recent_idx
  on public.account_auth_attempts(username_hash, action, attempted_at desc);

alter table public.account_recovery_credentials enable row level security;
alter table public.deleted_usernames enable row level security;
alter table public.account_auth_attempts enable row level security;
revoke all on table public.account_recovery_credentials from public, anon, authenticated;
revoke all on table public.deleted_usernames from public, anon, authenticated;
revoke all on table public.account_auth_attempts from public, anon, authenticated;
revoke all on sequence public.account_auth_attempts_id_seq from public, anon, authenticated;

-- Profiles are provisioned only by the Auth trigger. Usernames are immutable.
revoke insert, delete on table public.profiles from authenticated;
revoke update (username) on table public.profiles from authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare requested_username text := lower(trim(new.raw_user_meta_data ->> 'username'));
begin
  if requested_username is null or requested_username !~ '^[a-z0-9_]{3,24}$'
    or exists (select 1 from public.deleted_usernames where username = requested_username) then
    raise exception 'A valid available username is required.' using errcode = 'check_violation';
  end if;
  insert into public.profiles(id, username) values (new.id, requested_username);
  return new;
end;
$$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create function public.account_auth_guard(
  request_fingerprint_hash text,
  requested_username text,
  requested_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fingerprint bytea;
  username_fingerprint bytea;
  recent_ip integer;
  recent_account integer;
  failed_ip integer;
begin
  if request_fingerprint_hash !~ '^[0-9a-f]{64}$'
    or requested_username !~ '^[a-z0-9_]{3,24}$'
    or requested_action not in ('login', 'signup', 'recover', 'change_password', 'delete') then
    return jsonb_build_object('allowed', false, 'captchaRequired', true);
  end if;
  fingerprint := decode(request_fingerprint_hash, 'hex');
  username_fingerprint := extensions.digest(requested_username, 'sha256');

  select count(*) into recent_ip from public.account_auth_attempts
    where fingerprint_hash = fingerprint and action = requested_action
      and attempted_at > now() - interval '15 minutes';
  select count(*) into recent_account from public.account_auth_attempts
    where username_hash = username_fingerprint and action = requested_action
      and attempted_at > now() - interval '15 minutes';
  select count(*) into failed_ip from public.account_auth_attempts
    where fingerprint_hash = fingerprint and action = requested_action and not succeeded
      and attempted_at > now() - interval '15 minutes';

  return jsonb_build_object(
    'allowed', recent_ip < 30 and recent_account < 12,
    'captchaRequired', failed_ip >= 3 or (requested_action = 'signup' and recent_ip >= 3)
  );
end;
$$;

create function public.record_account_auth_attempt(
  request_fingerprint_hash text,
  requested_username text,
  requested_action text,
  attempt_succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if request_fingerprint_hash ~ '^[0-9a-f]{64}$'
    and requested_username ~ '^[a-z0-9_]{3,24}$'
    and requested_action in ('login', 'signup', 'recover', 'change_password', 'delete') then
    insert into public.account_auth_attempts(fingerprint_hash, username_hash, action, succeeded)
      values (
        decode(request_fingerprint_hash, 'hex'),
        extensions.digest(requested_username, 'sha256'),
        requested_action,
        attempt_succeeded
      );
  end if;
  delete from public.account_auth_attempts where attempted_at < now() - interval '24 hours';
end;
$$;

create function public.set_account_recovery_code(target_user_id uuid, recovery_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null or recovery_code !~ '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$' then
    return false;
  end if;
  insert into public.account_recovery_credentials(user_id, code_hash, rotated_at)
    values (target_user_id, extensions.crypt(recovery_code, extensions.gen_salt('bf', 12)), now())
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, rotated_at = excluded.rotated_at;
  return true;
end;
$$;

create function public.verify_account_recovery_code(requested_username text, recovery_code text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select profiles.id
  from public.profiles
  join public.account_recovery_credentials credentials on credentials.user_id = profiles.id
  where profiles.username = lower(trim(requested_username))
    and credentials.code_hash = extensions.crypt(upper(trim(recovery_code)), credentials.code_hash)
$$;

create function public.prepare_account_deletion(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare account_username text;
begin
  if exists (select 1 from public.channels where owner_user_id = target_user_id) then
    return false;
  end if;
  select username into account_username from public.profiles where id = target_user_id for update;
  if account_username is null then return false; end if;
  insert into public.deleted_usernames(username) values (account_username) on conflict do nothing;
  return true;
end;
$$;

create function public.revoke_all_account_sessions(target_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = target_user_id
$$;

revoke all on function public.account_auth_guard(text, text, text) from public, anon, authenticated;
revoke all on function public.record_account_auth_attempt(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.set_account_recovery_code(uuid, text) from public, anon, authenticated;
revoke all on function public.verify_account_recovery_code(text, text) from public, anon, authenticated;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.revoke_all_account_sessions(uuid) from public, anon, authenticated;
grant execute on function public.account_auth_guard(text, text, text) to service_role;
grant execute on function public.record_account_auth_attempt(text, text, text, boolean) to service_role;
grant execute on function public.set_account_recovery_code(uuid, text) to service_role;
grant execute on function public.verify_account_recovery_code(text, text) to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
grant execute on function public.revoke_all_account_sessions(uuid) to service_role;

-- Remove every test-only Channel identity and every Channel owned by one.
delete from public.channels where owner_identity_id is not null;
alter table public.channel_invite_links drop constraint if exists channel_invite_links_one_creator_check;
alter table public.channel_invite_links drop column if exists created_by_identity;
alter table public.channel_invite_links alter column created_by set not null;
alter table public.channels drop constraint if exists channels_exactly_one_owner_check;
alter table public.channels drop constraint if exists channels_owner_identity_fkey;
alter table public.channels drop constraint if exists channels_owner_identity_id_fkey;
alter table public.channels drop column if exists owner_identity_id;
alter table public.channels drop column if exists public_id;
alter table public.channels drop column if exists last_identity_activity_at;
alter table public.channels alter column owner_user_id set not null;

create or replace function public.create_channel(channel_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized_name text := trim(channel_name);
  new_channel_id uuid;
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  if length(normalized_name) not between 1 and 80 then
    raise exception 'Group name must be between 1 and 80 characters.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || lower(normalized_name), 0));
  if exists (
    select 1 from public.channels
    where owner_user_id = caller_id and lower(trim(name)) = lower(normalized_name)
  ) then
    raise exception 'A group with this name already exists.' using errcode = 'unique_violation';
  end if;
  insert into public.channels(owner_user_id, name)
    values (caller_id, normalized_name) returning id into new_channel_id;
  insert into public.channel_members(channel_id, user_id, role)
    values (new_channel_id, caller_id, 'owner');
  return new_channel_id;
end;
$$;

drop table if exists public.channel_identity_notification_reads cascade;
drop table if exists public.channel_identity_marks cascade;
drop table if exists public.channel_identity_sessions cascade;
drop table if exists public.channel_identity_attempts cascade;
drop table if exists public.channel_identity_audit cascade;
drop table if exists public.channel_identities cascade;
drop table if exists public.channel_guest_access_attempts cascade;
drop table if exists public.channel_guest_join_attempts cascade;
drop table if exists public.channel_guests cascade;

-- Drop trusted endpoints that may survive PL/pgSQL dependency tracking.
drop function if exists public.issue_channel_identity_session(uuid);
drop function if exists public.authenticate_channel_identity(text);
drop function if exists public.channel_identity_view(uuid);
drop function if exists public.create_channel_identity_owner(text, text, text);
drop function if exists public.create_channel_identity_member(text, text, text);
drop function if exists public.login_channel_identity(text, text, text);
drop function if exists public.read_channel_identity_session(text);
drop function if exists public.toggle_channel_identity_mark(text, date, text);
drop function if exists public.rotate_channel_identity_code(text);
drop function if exists public.create_channel_identity_invite_link(text);
drop function if exists public.revoke_channel_identity_invite_link(text, uuid);
drop function if exists public.leave_channel_identity(text);
drop function if exists public.remove_channel_identity(text, uuid);
drop function if exists public.delete_channel_as_identity(text);
drop function if exists public.logout_channel_identity(text);
drop function if exists public.merge_channel_identity_into_account(text, uuid);
drop function if exists public.cleanup_inactive_channel_identity_channels();
drop function if exists public.remove_channel_identity_as_account(uuid, uuid);
drop function if exists public.rename_channel_as_identity(text, text);
drop function if exists public.perform_channel_owner_transfer(uuid, text, uuid);
drop function if exists public.transfer_channel_ownership_as_identity(text, text, uuid);
drop function if exists public.remove_channel_participant_as_identity(text, text, uuid);
drop function if exists public.list_channel_identity_notifications(text);
drop function if exists public.mark_channel_identity_notifications_read(text);
drop function if exists public.create_channel_guest(text, text);
drop function if exists public.create_channel_guest_limited(text, text, text);
drop function if exists public.read_channel_as_guest(uuid, text);
drop function if exists public.accept_channel_invite_link(text, boolean);

-- Invitation links are revocable and otherwise permanent. Expiry/use-limit
-- columns are removed so old semantics cannot leak back into the product.
alter table public.channel_invite_links drop constraint if exists channel_invite_links_max_uses_check;
alter table public.channel_invite_links drop constraint if exists channel_invite_links_use_count_check;
alter table public.channel_invite_links drop column if exists expires_at cascade;
alter table public.channel_invite_links drop column if exists max_uses cascade;
alter table public.channel_invite_links drop column if exists use_count cascade;

drop function if exists public.create_channel_invite_link(uuid);
create function public.create_channel_invite_link(target_channel_id uuid)
returns table (invite_link_id uuid, invite_token text)
language plpgsql security definer set search_path = ''
as $$
declare raw_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the group owner can create invite links.' using errcode = 'insufficient_privilege';
  end if;
  update public.channel_invite_links set revoked_at = now()
    where channel_id = target_channel_id and revoked_at is null;
  return query
  insert into public.channel_invite_links(channel_id, created_by, token_hash)
    values (target_channel_id, auth.uid(), extensions.digest(raw_token, 'sha256'))
  returning id, raw_token;
end;
$$;

create or replace function public.preview_channel_invite(invite_token text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'channelId', channels.id,
    'channelName', channels.name,
    'memberCount', (select count(*) from public.channel_members where channel_id = channels.id)
  )
  from public.channel_invite_links links
  join public.channels on channels.id = links.channel_id
  where links.token_hash = extensions.digest(invite_token, 'sha256')
    and links.revoked_at is null
$$;

create or replace function public.accept_channel_invite_link(invite_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare link_row public.channel_invite_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  select * into link_row from public.channel_invite_links
    where token_hash = extensions.digest(invite_token, 'sha256') and revoked_at is null for update;
  if link_row.id is null then
    raise exception 'Invite link is invalid.' using errcode = 'invalid_authorization_specification';
  end if;
  insert into public.channel_members(channel_id, user_id, role)
    values (link_row.channel_id, auth.uid(), 'member') on conflict do nothing;
  return link_row.channel_id;
end;
$$;

-- New marks are always private. Sharing is always an explicit follow-up action.
drop function if exists public.set_channel_auto_share(uuid, boolean);
alter table public.channel_members drop column if exists auto_share_new_marks cascade;
create or replace function public.create_watch_mark_with_defaults(target_window_start date, target_showing_id text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare caller_id uuid := auth.uid(); new_mark_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.watch_marks(user_id, window_start, showing_id)
    values (caller_id, target_window_start, target_showing_id)
  on conflict (user_id, window_start, showing_id) do update set showing_id = excluded.showing_id
  returning id into new_mark_id;
  return new_mark_id;
end;
$$;

create or replace function public.list_channel_shared_marks(target_channel_id uuid)
returns table (
  mark_id uuid, window_start date, showing_id text, user_id uuid,
  username text, shared_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select marks.id, marks.window_start, marks.showing_id, marks.user_id,
    profiles.username, shares.created_at
  from public.channel_mark_shares shares
  join public.watch_marks marks on marks.id = shares.mark_id
  join public.profiles on profiles.id = marks.user_id
  where shares.channel_id = target_channel_id and public.is_channel_member(target_channel_id)
  order by shares.created_at desc
$$;

create or replace function public.leave_channel(target_channel_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_channel_owner(target_channel_id) then
    raise exception 'The owner must transfer or delete the group.' using errcode = 'check_violation';
  end if;
  delete from public.channel_mark_shares where channel_id = target_channel_id and shared_by = auth.uid();
  delete from public.channel_members where channel_id = target_channel_id and user_id = auth.uid();
end;
$$;

create or replace function public.remove_channel_member(target_channel_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the group owner can remove members.' using errcode = 'insufficient_privilege';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'The owner cannot remove themselves.' using errcode = 'check_violation';
  end if;
  delete from public.channel_mark_shares where channel_id = target_channel_id and shared_by = target_user_id;
  delete from public.channel_members where channel_id = target_channel_id and user_id = target_user_id and role = 'member';
end;
$$;

-- Friend IDs, direct invitations, and private-email lookups no longer exist.
drop function if exists public.rotate_friend_id();
drop function if exists public.get_my_friend_id();
drop function if exists public.generate_channel_identity_code();
drop function if exists public.invite_channel_user(uuid, text, text);
drop function if exists public.invite_channel_user_by_friend_id(uuid, text);
drop function if exists public.invite_channel_user_by_email(uuid, uuid, text);
drop function if exists public.accept_channel_invitation(uuid);
drop function if exists public.accept_channel_invitation(uuid, boolean);
drop function if exists public.list_my_channel_invitations();
drop table if exists public.channel_invitations cascade;
alter table public.profiles drop column if exists friend_id;
drop function if exists public.generate_friend_id();

-- Restore account-only participant and notification queries after dropping identity dependencies.
drop function if exists public.list_channel_participants(uuid);
create or replace function public.list_channel_participants(target_channel_id uuid)
returns table(participant_id uuid, display_name text, role text)
language sql stable security definer set search_path = ''
as $$
  select members.user_id, profiles.username, members.role
  from public.channel_members members
  join public.profiles on profiles.id = members.user_id
  where members.channel_id = target_channel_id and public.is_channel_member(target_channel_id)
  order by members.joined_at
$$;

drop function if exists public.transfer_channel_ownership(uuid, text, uuid);
create function public.transfer_channel_ownership(target_channel_id uuid, target_participant_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the group owner can transfer ownership.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.channel_members where channel_id = target_channel_id
      and user_id = target_participant_id and role = 'member'
  ) then
    raise exception 'The selected member cannot become owner.' using errcode = 'check_violation';
  end if;
  update public.channel_members set role = 'member'
    where channel_id = target_channel_id and user_id = auth.uid();
  update public.channel_members set role = 'owner'
    where channel_id = target_channel_id and user_id = target_participant_id;
  update public.channels set owner_user_id = target_participant_id where id = target_channel_id;
end;
$$;

drop function if exists public.list_my_channel_notifications();
create function public.list_my_channel_notifications()
returns table (
  channel_id uuid, channel_name text, window_start date, showing_id text,
  actor_names text[], actor_count integer, shared_at timestamptz, is_new boolean
)
language sql stable security definer set search_path = ''
as $$
  select members.channel_id, channels.name, marks.window_start, marks.showing_id,
    array_agg(distinct profiles.username order by profiles.username),
    count(distinct marks.user_id)::integer, max(shares.created_at),
    bool_or(shares.created_at > coalesce(reads.last_read_at, members.joined_at))
  from public.channel_members members
  join public.channels channels on channels.id = members.channel_id
  join public.channel_mark_shares shares on shares.channel_id = members.channel_id
  join public.watch_marks marks on marks.id = shares.mark_id and marks.user_id <> auth.uid()
  join public.profiles on profiles.id = marks.user_id
  left join public.channel_notification_reads reads
    on reads.user_id = members.user_id and reads.channel_id = members.channel_id
  where members.user_id = auth.uid() and shares.created_at >= now() - interval '14 days'
  group by members.channel_id, channels.name, marks.window_start, marks.showing_id
  order by max(shares.created_at) desc limit 100
$$;

revoke all on function public.create_channel_invite_link(uuid) from public, anon;
revoke all on function public.create_channel(text) from public, anon;
revoke all on function public.preview_channel_invite(text) from public, anon, authenticated;
revoke all on function public.accept_channel_invite_link(text) from public, anon;
revoke all on function public.create_watch_mark_with_defaults(date, text) from public, anon;
revoke all on function public.list_channel_shared_marks(uuid) from public, anon;
revoke all on function public.leave_channel(uuid) from public, anon;
revoke all on function public.remove_channel_member(uuid, uuid) from public, anon;
revoke all on function public.list_channel_participants(uuid) from public, anon;
revoke all on function public.transfer_channel_ownership(uuid, uuid) from public, anon;
revoke all on function public.list_my_channel_notifications() from public, anon;
grant execute on function public.create_channel_invite_link(uuid) to authenticated;
grant execute on function public.create_channel(text) to authenticated;
grant execute on function public.preview_channel_invite(text) to service_role;
grant execute on function public.accept_channel_invite_link(text) to authenticated;
grant execute on function public.create_watch_mark_with_defaults(date, text) to authenticated;
grant execute on function public.list_channel_shared_marks(uuid) to authenticated;
grant execute on function public.leave_channel(uuid) to authenticated;
grant execute on function public.remove_channel_member(uuid, uuid) to authenticated;
grant execute on function public.list_channel_participants(uuid) to authenticated;
grant execute on function public.transfer_channel_ownership(uuid, uuid) to authenticated;
grant execute on function public.list_my_channel_notifications() to authenticated;
