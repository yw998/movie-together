create or replace function generate_channel_identity_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  random_bytes bytea := extensions.gen_random_bytes(8);
  result text := '';
  position integer;
begin
  for position in 0..7 loop
    result := result || substr(alphabet, (get_byte(random_bytes, position) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

revoke all on function generate_channel_identity_code() from public, anon, authenticated;

alter table channels add column public_id text;
alter table channels add column last_identity_activity_at timestamptz not null default now();

do $$
declare channel_row record;
declare candidate text;
begin
  for channel_row in select id from public.channels where public_id is null loop
    loop
      candidate := 'CH-' || public.generate_channel_identity_code();
      exit when not exists (select 1 from public.channels where public_id = candidate);
    end loop;
    update public.channels set public_id = candidate where id = channel_row.id;
  end loop;
end;
$$;

alter table channels alter column public_id set not null;
alter table channels add constraint channels_public_id_key unique (public_id);
alter table channels alter column owner_user_id drop not null;

create or replace function create_channel(channel_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized_name text := trim(channel_name);
  new_channel_id uuid;
  next_public_id text;
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  if length(normalized_name) not between 1 and 80 then
    raise exception 'Channel name must be between 1 and 80 characters.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || lower(normalized_name), 0));
  if exists (select 1 from public.channels
      where owner_user_id = caller_id and lower(trim(name)) = lower(normalized_name)) then
    raise exception 'A channel with this name already exists.' using errcode = 'unique_violation';
  end if;
  loop
    next_public_id := 'CH-' || public.generate_channel_identity_code();
    exit when not exists (select 1 from public.channels where public_id = next_public_id);
  end loop;
  insert into public.channels(owner_user_id, name, public_id)
    values (caller_id, normalized_name, next_public_id) returning id into new_channel_id;
  insert into public.channel_members(channel_id, user_id, role)
    values (new_channel_id, caller_id, 'owner');
  return new_channel_id;
end;
$$;

create table channel_identities (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null,
  invite_link_id uuid references channel_invite_links(id) on delete set null,
  role text not null check (role in ('owner', 'member')),
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  access_code_hash text not null,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  unique (id, channel_id),
  foreign key (channel_id) references channels(id) on delete cascade
    deferrable initially deferred
);

create unique index channel_identities_display_name_idx
  on channel_identities(channel_id, lower(trim(display_name)));
create unique index channel_identities_one_owner_idx
  on channel_identities(channel_id) where role = 'owner';
create index channel_identities_channel_created_idx
  on channel_identities(channel_id, created_at);

alter table channels add column owner_identity_id uuid;
alter table channels add constraint channels_owner_identity_fkey
  foreign key (owner_identity_id) references channel_identities(id)
  deferrable initially deferred;
alter table channels add constraint channels_exactly_one_owner_check
  check ((owner_user_id is null) <> (owner_identity_id is null));

alter table channel_invite_links alter column created_by drop not null;
alter table channel_invite_links add column created_by_identity uuid
  references channel_identities(id) on delete cascade;
alter table channel_invite_links add constraint channel_invite_links_one_creator_check
  check ((created_by is null) <> (created_by_identity is null));

create table channel_identity_sessions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references channel_identities(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz
);

create index channel_identity_sessions_identity_idx
  on channel_identity_sessions(identity_id, expires_at desc);

create table channel_identity_marks (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null,
  channel_id uuid not null references channels(id) on delete cascade,
  window_start date not null,
  showing_id text not null,
  created_at timestamptz not null default now(),
  foreign key (identity_id, channel_id)
    references channel_identities(id, channel_id) on delete cascade,
  foreign key (window_start, showing_id)
    references showings(window_start, id) on delete restrict,
  unique (identity_id, window_start, showing_id)
);

create index channel_identity_marks_channel_created_idx
  on channel_identity_marks(channel_id, created_at desc);

create table channel_identity_attempts (
  id bigint generated always as identity primary key,
  action text not null check (action in ('create', 'join', 'login')),
  fingerprint_hash bytea not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);

create index channel_identity_attempts_recent_idx
  on channel_identity_attempts(action, fingerprint_hash, attempted_at desc);

create table channel_identity_audit (
  id bigint generated always as identity primary key,
  identity_id uuid,
  channel_id uuid,
  event_type text not null check (event_type in ('created', 'code_rotated', 'removed', 'left', 'merged')),
  former_display_name text,
  target_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table channel_identities enable row level security;
alter table channel_identity_sessions enable row level security;
alter table channel_identity_marks enable row level security;
alter table channel_identity_attempts enable row level security;
alter table channel_identity_audit enable row level security;

revoke all on table channel_identities from anon, authenticated;
revoke all on table channel_identity_sessions from anon, authenticated;
revoke all on table channel_identity_marks from anon, authenticated;
revoke all on table channel_identity_attempts from anon, authenticated;
revoke all on table channel_identity_audit from anon, authenticated;
revoke all on sequence channel_identity_attempts_id_seq from anon, authenticated;
revoke all on sequence channel_identity_audit_id_seq from anon, authenticated;

create or replace function issue_channel_identity_session(target_identity_id uuid)
returns table (session_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare raw_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  return query
  insert into public.channel_identity_sessions (identity_id, token_hash)
  values (target_identity_id, extensions.digest(raw_token, 'sha256'))
  returning raw_token, channel_identity_sessions.expires_at;
end;
$$;

create or replace function authenticate_channel_identity(session_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid;
declare target_channel_id uuid;
begin
  if session_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select sessions.identity_id, identities.channel_id
    into target_identity_id, target_channel_id
  from public.channel_identity_sessions sessions
  join public.channel_identities identities on identities.id = sessions.identity_id
  where sessions.token_hash = extensions.digest(session_token, 'sha256')
    and sessions.revoked_at is null
    and sessions.expires_at > now()
  for update of sessions;
  if target_identity_id is null then return null; end if;
  update public.channel_identity_sessions
    set last_active_at = now(), expires_at = now() + interval '30 days'
    where token_hash = extensions.digest(session_token, 'sha256');
  update public.channel_identities set last_activity_at = now() where id = target_identity_id;
  update public.channels set last_identity_activity_at = now() where id = target_channel_id;
  return target_identity_id;
end;
$$;

create or replace function channel_identity_view(target_identity_id uuid)
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
      where links.channel_id = channels.id and links.created_by_identity = identities.id
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

create or replace function create_channel_identity_owner(
  channel_name text,
  identity_display_name text,
  request_fingerprint_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare fingerprint bytea;
declare new_channel_id uuid := gen_random_uuid();
declare new_identity_id uuid := gen_random_uuid();
declare raw_code text;
declare next_public_id text;
declare session_row record;
begin
  if request_fingerprint_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  fingerprint := decode(request_fingerprint_hash, 'hex');
  if (select count(*) >= 10 from public.channel_identity_attempts
      where action = 'create' and fingerprint_hash = fingerprint
        and attempted_at > now() - interval '15 minutes') then return null; end if;
  if length(trim(channel_name)) not between 1 and 80
      or length(trim(identity_display_name)) not between 1 and 40 then
    insert into public.channel_identity_attempts(action, fingerprint_hash, succeeded)
      values ('create', fingerprint, false);
    return null;
  end if;
  loop
    next_public_id := 'CH-' || public.generate_channel_identity_code();
    exit when not exists (select 1 from public.channels where public_id = next_public_id);
  end loop;
  raw_code := public.generate_channel_identity_code();
  insert into public.channel_identities(id, channel_id, role, display_name, access_code_hash)
    values (new_identity_id, new_channel_id, 'owner', trim(identity_display_name),
      extensions.crypt(raw_code, extensions.gen_salt('bf', 10)));
  insert into public.channels(id, owner_user_id, owner_identity_id, name, public_id)
    values (new_channel_id, null, new_identity_id, trim(channel_name), next_public_id);
  select * into session_row from public.issue_channel_identity_session(new_identity_id);
  insert into public.channel_identity_attempts(action, fingerprint_hash, succeeded)
    values ('create', fingerprint, true);
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name)
    values (new_identity_id, new_channel_id, 'created', trim(identity_display_name));
  return jsonb_build_object('sessionToken', session_row.session_token, 'accessCode',
    substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4),
    'view', public.channel_identity_view(new_identity_id));
exception when unique_violation then
  insert into public.channel_identity_attempts(action, fingerprint_hash, succeeded)
    values ('create', fingerprint, false);
  return null;
end;
$$;

create or replace function create_channel_identity_member(
  invite_token text,
  identity_display_name text,
  request_fingerprint_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare fingerprint bytea;
declare link_row public.channel_invite_links%rowtype;
declare new_identity_id uuid := gen_random_uuid();
declare raw_code text;
declare session_row record;
begin
  if request_fingerprint_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  fingerprint := decode(request_fingerprint_hash, 'hex');
  if (select count(*) >= 10 from public.channel_identity_attempts
      where action = 'join' and fingerprint_hash = fingerprint
        and attempted_at > now() - interval '15 minutes') then return null; end if;
  if invite_token !~ '^[0-9a-f]{64}$'
      or length(trim(identity_display_name)) not between 1 and 40 then return null; end if;
  select * into link_row from public.channel_invite_links
    where token_hash = extensions.digest(invite_token, 'sha256')
      and revoked_at is null and expires_at > now() and use_count < max_uses
    for update;
  if link_row.id is null then return null; end if;
  if exists (
    select 1 from public.channel_members members
    join public.profiles on profiles.id = members.user_id
    where members.channel_id = link_row.channel_id
      and lower(profiles.username) = lower(trim(identity_display_name))
  ) then
    return null;
  end if;
  loop
    raw_code := public.generate_channel_identity_code();
    exit when not exists (
      select 1 from public.channel_identities identities
      where identities.channel_id = link_row.channel_id
        and extensions.crypt(raw_code, identities.access_code_hash) = identities.access_code_hash
    );
  end loop;
  insert into public.channel_identities(id, channel_id, invite_link_id, role, display_name, access_code_hash)
    values (new_identity_id, link_row.channel_id, link_row.id, 'member', trim(identity_display_name),
      extensions.crypt(raw_code, extensions.gen_salt('bf', 10)));
  update public.channel_invite_links set use_count = use_count + 1 where id = link_row.id;
  update public.channels set last_identity_activity_at = now() where id = link_row.channel_id;
  select * into session_row from public.issue_channel_identity_session(new_identity_id);
  insert into public.channel_identity_attempts(action, fingerprint_hash, succeeded)
    values ('join', fingerprint, true);
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name)
    values (new_identity_id, link_row.channel_id, 'created', trim(identity_display_name));
  return jsonb_build_object('sessionToken', session_row.session_token, 'accessCode',
    substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4),
    'view', public.channel_identity_view(new_identity_id));
exception when unique_violation then
  insert into public.channel_identity_attempts(action, fingerprint_hash, succeeded)
    values ('join', fingerprint, false);
  return null;
end;
$$;

create or replace function login_channel_identity(
  target_public_channel_id text,
  access_code text,
  request_fingerprint_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare fingerprint bytea;
declare normalized_code text := regexp_replace(upper(access_code), '[^A-Z0-9]', '', 'g');
declare target_identity_id uuid;
declare session_row record;
begin
  if request_fingerprint_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  fingerprint := decode(request_fingerprint_hash, 'hex');
  if (select count(*) >= 20 from public.channel_identity_attempts
      where action = 'login' and fingerprint_hash = fingerprint
        and attempted_at > now() - interval '1 minute') then return null; end if;
  if normalized_code !~ '^[A-HJ-NP-Z2-9]{8}$' then return null; end if;
  select identities.id into target_identity_id
  from public.channel_identities identities
  join public.channels on channels.id = identities.channel_id
  where channels.public_id = upper(trim(target_public_channel_id))
    and extensions.crypt(normalized_code, identities.access_code_hash) = identities.access_code_hash
  limit 1;
  insert into public.channel_identity_attempts(action, fingerprint_hash, succeeded)
    values ('login', fingerprint, target_identity_id is not null);
  if target_identity_id is null then return null; end if;
  select * into session_row from public.issue_channel_identity_session(target_identity_id);
  update public.channel_identities set last_activity_at = now() where id = target_identity_id;
  update public.channels set last_identity_activity_at = now()
    where id = (select channel_id from public.channel_identities where id = target_identity_id);
  return jsonb_build_object('sessionToken', session_row.session_token,
    'view', public.channel_identity_view(target_identity_id));
end;
$$;

create or replace function read_channel_identity_session(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
begin
  if target_identity_id is null then return null; end if;
  return public.channel_identity_view(target_identity_id);
end;
$$;

create or replace function toggle_channel_identity_mark(
  session_token text,
  target_window_start date,
  target_showing_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
declare target_channel_id uuid;
declare removed boolean := false;
begin
  if target_identity_id is null then return null; end if;
  select channel_id into target_channel_id from public.channel_identities where id = target_identity_id;
  delete from public.channel_identity_marks
    where identity_id = target_identity_id and window_start = target_window_start
      and showing_id = target_showing_id;
  removed := found;
  if not removed then
    insert into public.channel_identity_marks(identity_id, channel_id, window_start, showing_id)
      select target_identity_id, target_channel_id, showings.window_start, showings.id
      from public.showings
      where showings.window_start = target_window_start
        and showings.id = target_showing_id
        and showings.publication_status = 'active';
    if not found then return null; end if;
  end if;
  return jsonb_build_object('action', case when removed then 'removed' else 'created' end,
    'view', public.channel_identity_view(target_identity_id));
end;
$$;

create or replace function rotate_channel_identity_code(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
declare raw_code text;
declare session_row record;
declare target_channel_id uuid;
declare target_display_name text;
begin
  if target_identity_id is null then return null; end if;
  loop
    raw_code := public.generate_channel_identity_code();
    exit when not exists (
      select 1 from public.channel_identities identities
      where identities.channel_id = (select channel_id from public.channel_identities where id = target_identity_id)
        and identities.id <> target_identity_id
        and extensions.crypt(raw_code, identities.access_code_hash) = identities.access_code_hash
    );
  end loop;
  update public.channel_identities
    set access_code_hash = extensions.crypt(raw_code, extensions.gen_salt('bf', 10)), last_activity_at = now()
    where id = target_identity_id
    returning channel_id, display_name into target_channel_id, target_display_name;
  update public.channel_identity_sessions set revoked_at = now()
    where identity_id = target_identity_id and revoked_at is null;
  select * into session_row from public.issue_channel_identity_session(target_identity_id);
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name)
    values (target_identity_id, target_channel_id, 'code_rotated', target_display_name);
  return jsonb_build_object('sessionToken', session_row.session_token, 'accessCode',
    substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4),
    'view', public.channel_identity_view(target_identity_id));
end;
$$;

create or replace function create_channel_identity_invite_link(session_token text)
returns table (invite_token text, expires_at timestamptz, max_uses integer)
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
declare target_channel_id uuid;
declare raw_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  select channel_id into target_channel_id from public.channel_identities
    where id = target_identity_id and role = 'owner';
  if target_channel_id is null then return; end if;
  update public.channels set last_identity_activity_at = now() where id = target_channel_id;
  return query insert into public.channel_invite_links(channel_id, created_by, created_by_identity, token_hash)
    values (target_channel_id, null, target_identity_id, extensions.digest(raw_token, 'sha256'))
    returning raw_token, channel_invite_links.expires_at, channel_invite_links.max_uses;
end;
$$;

create or replace function revoke_channel_identity_invite_link(session_token text, target_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
begin
  update public.channel_invite_links links set revoked_at = coalesce(links.revoked_at, now())
  where links.id = target_link_id
    and links.channel_id = (select identities.channel_id from public.channel_identities identities
      where identities.id = target_identity_id and identities.role = 'owner');
  if not found then return false; end if;
  update public.channels set last_identity_activity_at = now()
    where id = (select channel_id from public.channel_identities where id = target_identity_id);
  return true;
end;
$$;

create or replace function leave_channel_identity(session_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
declare identity_row public.channel_identities%rowtype;
begin
  select * into identity_row from public.channel_identities where id = target_identity_id for update;
  if identity_row.id is null or identity_row.role = 'owner' then return false; end if;
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name)
    values (identity_row.id, identity_row.channel_id, 'left', identity_row.display_name);
  delete from public.channel_identities where id = identity_row.id;
  update public.channels set last_identity_activity_at = now() where id = identity_row.channel_id;
  return true;
end;
$$;

create or replace function remove_channel_identity(session_token text, target_identity_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare owner_identity_id uuid := public.authenticate_channel_identity(session_token);
declare target_row public.channel_identities%rowtype;
begin
  if not exists (select 1 from public.channel_identities where id = owner_identity_id and role = 'owner') then return false; end if;
  select * into target_row from public.channel_identities
    where id = target_identity_id and role = 'member'
      and channel_id = (select channel_id from public.channel_identities where id = owner_identity_id)
    for update;
  if target_row.id is null then return false; end if;
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name)
    values (target_row.id, target_row.channel_id, 'removed', target_row.display_name);
  delete from public.channel_identities where id = target_row.id;
  update public.channels set last_identity_activity_at = now() where id = target_row.channel_id;
  return true;
end;
$$;

create or replace function delete_channel_as_identity(session_token text)
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
  delete from public.channels where id = target_channel_id;
  return true;
end;
$$;

create or replace function logout_channel_identity(session_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.channel_identity_sessions set revoked_at = coalesce(revoked_at, now())
  where token_hash = extensions.digest(session_token, 'sha256')
$$;

create or replace function merge_channel_identity_into_account(
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
  insert into public.watch_marks(user_id, window_start, showing_id)
    select target_user_id, window_start, showing_id
    from public.channel_identity_marks where identity_id = identity_row.id
    on conflict (user_id, window_start, showing_id) do nothing;
  insert into public.channel_mark_shares(channel_id, mark_id, shared_by)
    select identity_row.channel_id, marks.id, target_user_id
    from public.watch_marks marks
    join public.channel_identity_marks old_marks
      on old_marks.window_start = marks.window_start and old_marks.showing_id = marks.showing_id
    where old_marks.identity_id = identity_row.id and marks.user_id = target_user_id
    on conflict (channel_id, mark_id) do nothing;
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name, target_user_id)
    values (identity_row.id, identity_row.channel_id, 'merged', identity_row.display_name, target_user_id);
  delete from public.channel_identities where id = identity_row.id;
  return identity_row.channel_id;
end;
$$;

create or replace function cleanup_inactive_channel_identity_channels()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count integer;
begin
  delete from public.channels
  where owner_identity_id is not null
    and last_identity_activity_at < now() - interval '180 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function list_channel_participants(target_channel_id uuid)
returns table (
  participant_id uuid,
  display_name text,
  role text,
  kind text,
  joined_at timestamptz,
  auto_share_new_marks boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select members.user_id, profiles.username, members.role, 'account'::text,
    members.joined_at, members.auto_share_new_marks
  from public.channel_members members
  join public.profiles on profiles.id = members.user_id
  where members.channel_id = target_channel_id and public.is_channel_member(target_channel_id)
  union all
  select identities.id, identities.display_name, identities.role, 'channel_only'::text,
    identities.created_at, false
  from public.channel_identities identities
  where identities.channel_id = target_channel_id and public.is_channel_member(target_channel_id)
  order by 5
$$;

create or replace function list_channel_shared_marks(target_channel_id uuid)
returns table (
  mark_id uuid,
  window_start date,
  showing_id text,
  user_id uuid,
  username text,
  shared_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select marks.id, marks.window_start, marks.showing_id, marks.user_id,
    profiles.username, shares.created_at
  from public.channel_mark_shares shares
  join public.watch_marks marks on marks.id = shares.mark_id
  join public.profiles on profiles.id = marks.user_id
  where shares.channel_id = target_channel_id and public.is_channel_member(target_channel_id)
  union all
  select marks.id, marks.window_start, marks.showing_id, marks.identity_id,
    identities.display_name, marks.created_at
  from public.channel_identity_marks marks
  join public.channel_identities identities on identities.id = marks.identity_id
  where marks.channel_id = target_channel_id and public.is_channel_member(target_channel_id)
  order by 6 desc
$$;

create or replace function remove_channel_identity_as_account(
  target_channel_id uuid,
  target_identity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_row public.channel_identities%rowtype;
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the channel owner can remove members.' using errcode = 'insufficient_privilege';
  end if;
  select * into target_row from public.channel_identities
    where id = target_identity_id and channel_id = target_channel_id and role = 'member' for update;
  if target_row.id is null then
    raise exception 'Channel-only member not found.' using errcode = 'no_data_found';
  end if;
  insert into public.channel_identity_audit(identity_id, channel_id, event_type, former_display_name)
    values (target_row.id, target_row.channel_id, 'removed', target_row.display_name);
  delete from public.channel_identities where id = target_row.id;
end;
$$;

update channel_guests set revoked_at = coalesce(revoked_at, now());

revoke all on function issue_channel_identity_session(uuid) from public, anon, authenticated;
revoke all on function authenticate_channel_identity(text) from public, anon, authenticated;
revoke all on function channel_identity_view(uuid) from public, anon, authenticated;
revoke all on function create_channel_identity_owner(text, text, text) from public, anon, authenticated;
revoke all on function create_channel_identity_member(text, text, text) from public, anon, authenticated;
revoke all on function login_channel_identity(text, text, text) from public, anon, authenticated;
revoke all on function read_channel_identity_session(text) from public, anon, authenticated;
revoke all on function toggle_channel_identity_mark(text, date, text) from public, anon, authenticated;
revoke all on function rotate_channel_identity_code(text) from public, anon, authenticated;
revoke all on function create_channel_identity_invite_link(text) from public, anon, authenticated;
revoke all on function revoke_channel_identity_invite_link(text, uuid) from public, anon, authenticated;
revoke all on function leave_channel_identity(text) from public, anon, authenticated;
revoke all on function remove_channel_identity(text, uuid) from public, anon, authenticated;
revoke all on function delete_channel_as_identity(text) from public, anon, authenticated;
revoke all on function logout_channel_identity(text) from public, anon, authenticated;
revoke all on function merge_channel_identity_into_account(text, uuid) from public, anon, authenticated;
revoke all on function cleanup_inactive_channel_identity_channels() from public, anon, authenticated;
revoke all on function list_channel_participants(uuid) from public, anon;
revoke all on function list_channel_shared_marks(uuid) from public, anon;
revoke all on function remove_channel_identity_as_account(uuid, uuid) from public, anon;

grant execute on function create_channel_identity_owner(text, text, text) to service_role;
grant execute on function create_channel_identity_member(text, text, text) to service_role;
grant execute on function login_channel_identity(text, text, text) to service_role;
grant execute on function read_channel_identity_session(text) to service_role;
grant execute on function toggle_channel_identity_mark(text, date, text) to service_role;
grant execute on function rotate_channel_identity_code(text) to service_role;
grant execute on function create_channel_identity_invite_link(text) to service_role;
grant execute on function revoke_channel_identity_invite_link(text, uuid) to service_role;
grant execute on function leave_channel_identity(text) to service_role;
grant execute on function remove_channel_identity(text, uuid) to service_role;
grant execute on function delete_channel_as_identity(text) to service_role;
grant execute on function logout_channel_identity(text) to service_role;
grant execute on function merge_channel_identity_into_account(text, uuid) to service_role;
grant execute on function cleanup_inactive_channel_identity_channels() to service_role;
grant execute on function list_channel_participants(uuid) to authenticated;
grant execute on function list_channel_shared_marks(uuid) to authenticated;
grant execute on function remove_channel_identity_as_account(uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if not exists (select 1 from cron.job where jobname = 'cleanup-channel-only-identities') then
      perform cron.schedule(
        'cleanup-channel-only-identities',
        '17 9 * * *',
        'select public.cleanup_inactive_channel_identity_channels()'
      );
    end if;
  end if;
end;
$$;
