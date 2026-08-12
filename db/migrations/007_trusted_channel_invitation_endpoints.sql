create table channel_guest_access_attempts (
  id bigint generated always as identity primary key,
  guest_id uuid not null references channel_guests(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);

create index channel_guest_access_attempts_recent_idx
  on channel_guest_access_attempts(guest_id, attempted_at desc);

create table channel_guest_join_attempts (
  id bigint generated always as identity primary key,
  fingerprint_hash bytea not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);

create index channel_guest_join_attempts_recent_idx
  on channel_guest_join_attempts(fingerprint_hash, attempted_at desc);

alter table channel_guest_access_attempts enable row level security;
alter table channel_guest_join_attempts enable row level security;
revoke all on table channel_guest_access_attempts from anon, authenticated;
revoke all on table channel_guest_join_attempts from anon, authenticated;
revoke all on sequence channel_guest_access_attempts_id_seq from anon, authenticated;
revoke all on sequence channel_guest_join_attempts_id_seq from anon, authenticated;

create or replace function preview_channel_invite(invite_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'channelId', channels.id,
    'channelName', channels.name,
    'expiresAt', links.expires_at
  )
  from public.channel_invite_links links
  join public.channels on channels.id = links.channel_id
  where links.token_hash = extensions.digest(invite_token, 'sha256')
    and links.revoked_at is null
    and links.expires_at > now()
    and links.use_count < links.max_uses
$$;

create or replace function create_channel_guest_limited(
  invite_token text,
  guest_name text,
  request_fingerprint_hash text
)
returns table (guest_id uuid, channel_id uuid, access_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.channel_invite_links%rowtype;
  fingerprint bytea;
  raw_code text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if request_fingerprint_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  fingerprint := decode(request_fingerprint_hash, 'hex');
  if (
    select count(*) >= 10
    from public.channel_guest_join_attempts
    where fingerprint_hash = fingerprint
      and not succeeded
      and attempted_at > now() - interval '15 minutes'
  ) then
    return;
  end if;
  if length(trim(guest_name)) not between 1 and 40 then
    insert into public.channel_guest_join_attempts (fingerprint_hash, succeeded)
    values (fingerprint, false);
    return;
  end if;

  select * into link_row
  from public.channel_invite_links
  where token_hash = extensions.digest(invite_token, 'sha256')
    and revoked_at is null
    and expires_at > now()
    and use_count < max_uses
  for update;

  if link_row.id is null then
    insert into public.channel_guest_join_attempts (fingerprint_hash, succeeded)
    values (fingerprint, false);
    return;
  end if;

  update public.channel_invite_links set use_count = use_count + 1 where id = link_row.id;
  insert into public.channel_guest_join_attempts (fingerprint_hash, succeeded)
  values (fingerprint, true);
  return query
  insert into public.channel_guests (channel_id, invite_link_id, display_name, access_code_hash)
  values (link_row.channel_id, link_row.id, trim(guest_name), extensions.digest(raw_code, 'sha256'))
  returning id, channel_guests.channel_id, raw_code;
end;
$$;

create or replace function read_channel_as_guest(target_guest_id uuid, access_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_channel_id uuid;
  result jsonb;
begin
  if not exists (
    select 1 from public.channel_guests where id = target_guest_id
  ) then
    return null;
  end if;
  if (
    select count(*) >= 5
    from public.channel_guest_access_attempts
    where guest_id = target_guest_id
      and not succeeded
      and attempted_at > now() - interval '15 minutes'
  ) then
    return null;
  end if;

  select channel_id into target_channel_id
  from public.channel_guests
  where id = target_guest_id
    and revoked_at is null
    and access_code_hash = extensions.digest(access_code, 'sha256');

  insert into public.channel_guest_access_attempts (guest_id, succeeded)
  values (target_guest_id, target_channel_id is not null);
  if target_channel_id is null then
    return null;
  end if;

  update public.channel_guests set last_accessed_at = now() where id = target_guest_id;
  select jsonb_build_object(
    'channel', jsonb_build_object('id', channels.id, 'name', channels.name),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object('username', profiles.username, 'role', members.role)
        order by members.joined_at
      )
      from public.channel_members members
      join public.profiles on profiles.id = members.user_id
      where members.channel_id = channels.id
    ), '[]'::jsonb),
    'guests', coalesce((
      select jsonb_agg(
        jsonb_build_object('name', guests.display_name)
        order by guests.created_at
      )
      from public.channel_guests guests
      where guests.channel_id = channels.id and guests.revoked_at is null
    ), '[]'::jsonb)
  ) into result
  from public.channels where channels.id = target_channel_id;
  return result;
end;
$$;

create or replace function invite_channel_user_by_email(
  target_channel_id uuid,
  inviter_user_id uuid,
  target_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_id uuid;
begin
  if not exists (
    select 1 from public.channels
    where id = target_channel_id and owner_user_id = inviter_user_id
  ) then
    raise exception 'Only the channel owner can invite users.' using errcode = 'insufficient_privilege';
  end if;
  select id into target_id from auth.users
  where lower(email) = lower(trim(target_email))
  order by created_at limit 1;
  if target_id is null or target_id = inviter_user_id or exists (
    select 1 from public.channel_members
    where channel_id = target_channel_id and user_id = target_id
  ) then
    return;
  end if;
  update public.channel_invitations set status = 'revoked', responded_at = now()
  where channel_id = target_channel_id and invited_user_id = target_id and status = 'pending';
  insert into public.channel_invitations (channel_id, invited_user_id, invited_by)
  values (target_channel_id, target_id, inviter_user_id);
end;
$$;

revoke all on function preview_channel_invite(text) from public, anon, authenticated;
revoke all on function create_channel_guest_limited(text, text, text) from public, anon, authenticated;
revoke all on function read_channel_as_guest(uuid, text) from public, anon, authenticated;
revoke all on function invite_channel_user_by_email(uuid, uuid, text) from public, anon, authenticated;

grant execute on function preview_channel_invite(text) to service_role;
grant execute on function create_channel_guest_limited(text, text, text) to service_role;
grant execute on function read_channel_as_guest(uuid, text) to service_role;
grant execute on function invite_channel_user_by_email(uuid, uuid, text) to service_role;
