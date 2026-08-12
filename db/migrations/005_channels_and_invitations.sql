create or replace function generate_friend_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'MT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
$$;

revoke all on function generate_friend_id() from public;

alter table profiles add column friend_id text;
update profiles set friend_id = generate_friend_id() where friend_id is null;
alter table profiles alter column friend_id set default generate_friend_id();
alter table profiles alter column friend_id set not null;
alter table profiles add constraint profiles_friend_id_format_check
  check (friend_id ~ '^MT-[0-9A-F]{12}$');
alter table profiles add constraint profiles_friend_id_key unique (friend_id);

create table channels (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table channel_members (
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create unique index channel_members_one_owner_idx
  on channel_members(channel_id) where role = 'owner';
create index channel_members_user_idx on channel_members(user_id, joined_at desc);

create table channel_invitations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (invited_user_id <> invited_by)
);

create unique index channel_invitations_pending_target_idx
  on channel_invitations(channel_id, invited_user_id) where status = 'pending';
create index channel_invitations_target_idx
  on channel_invitations(invited_user_id, created_at desc);

create table channel_invite_links (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 20 check (max_uses between 1 and 20),
  use_count integer not null default 0 check (use_count between 0 and max_uses),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index channel_invite_links_channel_idx
  on channel_invite_links(channel_id, created_at desc);

create table channel_guests (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  invite_link_id uuid references channel_invite_links(id) on delete set null,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  access_code_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  revoked_at timestamptz
);

create index channel_guests_channel_idx on channel_guests(channel_id, created_at desc);

create or replace function is_channel_member(target_channel_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = target_channel_id and user_id = auth.uid()
  )
$$;

create or replace function is_channel_owner(target_channel_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.channels
    where id = target_channel_id and owner_user_id = auth.uid()
  )
$$;

create or replace function shares_channel_with(target_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.channel_members viewer
    join public.channel_members target using (channel_id)
    where viewer.user_id = auth.uid() and target.user_id = target_user_id
  )
$$;

revoke all on function is_channel_member(uuid) from public;
revoke all on function is_channel_owner(uuid) from public;
revoke all on function shares_channel_with(uuid) from public;
grant execute on function is_channel_member(uuid) to authenticated;
grant execute on function is_channel_owner(uuid) to authenticated;
grant execute on function shares_channel_with(uuid) to authenticated;

alter table channels enable row level security;
alter table channel_members enable row level security;
alter table channel_invitations enable row level security;
alter table channel_invite_links enable row level security;
alter table channel_guests enable row level security;

revoke all on table channels from anon, authenticated;
revoke all on table channel_members from anon, authenticated;
revoke all on table channel_invitations from anon, authenticated;
revoke all on table channel_invite_links from anon, authenticated;
revoke all on table channel_guests from anon, authenticated;

grant select on table channels to authenticated;
grant select on table channel_members to authenticated;
grant select on table channel_invitations to authenticated;
grant select (id, channel_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at)
  on table channel_invite_links to authenticated;
grant select (id, channel_id, display_name, created_at)
  on table channel_guests to authenticated;

create policy channels_select_member on channels for select to authenticated
  using (is_channel_member(id));
create policy channel_members_select_member on channel_members for select to authenticated
  using (is_channel_member(channel_id));
create policy channel_invitations_select_participant on channel_invitations for select to authenticated
  using (invited_user_id = (select auth.uid()) or is_channel_owner(channel_id));
create policy channel_invite_links_select_owner on channel_invite_links for select to authenticated
  using (is_channel_owner(channel_id));
create policy channel_guests_select_member on channel_guests for select to authenticated
  using (is_channel_member(channel_id));
create policy profiles_select_channel_peers on profiles for select to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false and
    shares_channel_with(id)
  );

create or replace function create_channel(channel_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_channel_id uuid;
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(channel_name)) not between 1 and 80 then
    raise exception 'Channel name must be between 1 and 80 characters.' using errcode = 'check_violation';
  end if;
  insert into public.channels (owner_user_id, name)
  values (caller_id, trim(channel_name)) returning id into new_channel_id;
  insert into public.channel_members (channel_id, user_id, role)
  values (new_channel_id, caller_id, 'owner');
  return new_channel_id;
end;
$$;

create or replace function rotate_friend_id()
returns text language plpgsql security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  next_friend_id text;
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  loop
    next_friend_id := public.generate_friend_id();
    begin
      update public.profiles set friend_id = next_friend_id where id = caller_id;
      return next_friend_id;
    exception when unique_violation then null;
    end;
  end loop;
end;
$$;

create or replace function get_my_friend_id()
returns text language sql stable security definer set search_path = ''
as $$ select friend_id from public.profiles where id = auth.uid() $$;

create or replace function invite_channel_user(
  target_channel_id uuid, identifier_kind text, identifier_value text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_id uuid;
  invitation_id uuid;
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the channel owner can invite users.' using errcode = 'insufficient_privilege';
  end if;
  if identifier_kind = 'username' then
    select id into target_id from public.profiles where username = lower(trim(identifier_value));
  elsif identifier_kind = 'friend_id' then
    select id into target_id from public.profiles where friend_id = upper(trim(identifier_value));
  else
    raise exception 'Unsupported invitation identifier.' using errcode = 'invalid_parameter_value';
  end if;
  if target_id is null then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  if target_id = caller_id or exists (
    select 1 from public.channel_members
    where channel_id = target_channel_id and user_id = target_id
  ) then
    raise exception 'The user is already a channel member.' using errcode = 'unique_violation';
  end if;
  update public.channel_invitations set status = 'revoked', responded_at = now()
  where channel_id = target_channel_id and invited_user_id = target_id and status = 'pending';
  insert into public.channel_invitations (channel_id, invited_user_id, invited_by)
  values (target_channel_id, target_id, caller_id) returning id into invitation_id;
  return invitation_id;
end;
$$;

create or replace function accept_channel_invitation(target_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_channel_id uuid;
begin
  select channel_id into target_channel_id from public.channel_invitations
  where id = target_invitation_id and invited_user_id = caller_id
    and status = 'pending' and expires_at > now() for update;
  if target_channel_id is null then
    raise exception 'Invitation is invalid or expired.' using errcode = 'invalid_authorization_specification';
  end if;
  insert into public.channel_members (channel_id, user_id, role)
  values (target_channel_id, caller_id, 'member') on conflict (channel_id, user_id) do nothing;
  update public.channel_invitations set status = 'accepted', responded_at = now()
  where id = target_invitation_id;
  return target_channel_id;
end;
$$;

create or replace function create_channel_invite_link(target_channel_id uuid)
returns table (invite_link_id uuid, invite_token text, expires_at timestamptz, max_uses integer)
language plpgsql security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  raw_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the channel owner can create invite links.' using errcode = 'insufficient_privilege';
  end if;
  return query
  insert into public.channel_invite_links (channel_id, created_by, token_hash)
  values (target_channel_id, caller_id, extensions.digest(raw_token, 'sha256'))
  returning id, raw_token, channel_invite_links.expires_at, channel_invite_links.max_uses;
end;
$$;

create or replace function accept_channel_invite_link(invite_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  link_row public.channel_invite_links%rowtype;
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  select * into link_row from public.channel_invite_links
  where token_hash = extensions.digest(invite_token, 'sha256') and revoked_at is null
    and expires_at > now() and use_count < max_uses for update;
  if link_row.id is null then
    raise exception 'Invite link is invalid or expired.' using errcode = 'invalid_authorization_specification';
  end if;
  if not public.is_channel_member(link_row.channel_id) then
    insert into public.channel_members (channel_id, user_id, role)
    values (link_row.channel_id, caller_id, 'member');
    update public.channel_invite_links set use_count = use_count + 1 where id = link_row.id;
  end if;
  return link_row.channel_id;
end;
$$;

create or replace function revoke_channel_invite_link(target_invite_link_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare target_channel_id uuid;
begin
  select channel_id into target_channel_id from public.channel_invite_links where id = target_invite_link_id;
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the channel owner can revoke invite links.' using errcode = 'insufficient_privilege';
  end if;
  update public.channel_invite_links set revoked_at = coalesce(revoked_at, now()) where id = target_invite_link_id;
end;
$$;

create or replace function leave_channel(target_channel_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_channel_owner(target_channel_id) then
    raise exception 'The owner must delete the channel instead of leaving it.' using errcode = 'check_violation';
  end if;
  delete from public.channel_members where channel_id = target_channel_id and user_id = auth.uid();
end;
$$;

create or replace function remove_channel_member(target_channel_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the channel owner can remove members.' using errcode = 'insufficient_privilege';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'The owner cannot remove themselves.' using errcode = 'check_violation';
  end if;
  delete from public.channel_members where channel_id = target_channel_id and user_id = target_user_id;
end;
$$;

create or replace function delete_channel(target_channel_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the channel owner can delete the channel.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.channels where id = target_channel_id;
end;
$$;

create or replace function create_channel_guest(invite_token text, guest_name text)
returns table (guest_id uuid, channel_id uuid, access_code text)
language plpgsql security definer set search_path = ''
as $$
declare
  link_row public.channel_invite_links%rowtype;
  raw_code text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if length(trim(guest_name)) not between 1 and 40 then
    raise exception 'Guest name must be between 1 and 40 characters.' using errcode = 'check_violation';
  end if;
  select * into link_row from public.channel_invite_links
  where token_hash = extensions.digest(invite_token, 'sha256') and revoked_at is null
    and expires_at > now() and use_count < max_uses for update;
  if link_row.id is null then
    raise exception 'Invite link is invalid or expired.' using errcode = 'invalid_authorization_specification';
  end if;
  update public.channel_invite_links set use_count = use_count + 1 where id = link_row.id;
  return query
  insert into public.channel_guests (channel_id, invite_link_id, display_name, access_code_hash)
  values (link_row.channel_id, link_row.id, trim(guest_name), extensions.digest(raw_code, 'sha256'))
  returning id, channel_guests.channel_id, raw_code;
end;
$$;

revoke all on function create_channel(text) from public;
revoke all on function rotate_friend_id() from public;
revoke all on function get_my_friend_id() from public;
revoke all on function invite_channel_user(uuid, text, text) from public;
revoke all on function accept_channel_invitation(uuid) from public;
revoke all on function create_channel_invite_link(uuid) from public;
revoke all on function accept_channel_invite_link(text) from public;
revoke all on function revoke_channel_invite_link(uuid) from public;
revoke all on function leave_channel(uuid) from public;
revoke all on function remove_channel_member(uuid, uuid) from public;
revoke all on function delete_channel(uuid) from public;
revoke all on function create_channel_guest(text, text) from public;

grant execute on function create_channel(text) to authenticated;
grant execute on function rotate_friend_id() to authenticated;
grant execute on function get_my_friend_id() to authenticated;
grant execute on function invite_channel_user(uuid, text, text) to authenticated;
grant execute on function accept_channel_invitation(uuid) to authenticated;
grant execute on function create_channel_invite_link(uuid) to authenticated;
grant execute on function accept_channel_invite_link(text) to authenticated;
grant execute on function revoke_channel_invite_link(uuid) to authenticated;
grant execute on function leave_channel(uuid) to authenticated;
grant execute on function remove_channel_member(uuid, uuid) to authenticated;
grant execute on function delete_channel(uuid) to authenticated;
grant execute on function create_channel_guest(text, text) to service_role;

create trigger channels_set_updated_at before update on channels
for each row execute function set_profile_updated_at();
