alter table channel_members
  add column auto_share_new_marks boolean not null default false;

alter table watch_marks
  add constraint watch_marks_id_user_key unique (id, user_id);

create table channel_mark_shares (
  channel_id uuid not null references channels(id) on delete cascade,
  mark_id uuid not null,
  shared_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (channel_id, mark_id),
  foreign key (mark_id, shared_by)
    references watch_marks(id, user_id) on delete cascade
);

create index channel_mark_shares_mark_idx on channel_mark_shares(mark_id);
create index channel_mark_shares_channel_created_idx
  on channel_mark_shares(channel_id, created_at desc);

alter table channel_mark_shares enable row level security;
revoke all on table channel_mark_shares from anon, authenticated;
grant select, insert, delete on table channel_mark_shares to authenticated;

create policy channel_mark_shares_select_member
  on channel_mark_shares for select to authenticated
  using (is_channel_member(channel_id));

create policy channel_mark_shares_insert_own
  on channel_mark_shares for insert to authenticated
  with check (
    shared_by = (select auth.uid())
    and is_channel_member(channel_id)
    and exists (
      select 1 from public.watch_marks
      where id = mark_id and user_id = (select auth.uid())
    )
  );

create policy channel_mark_shares_delete_own
  on channel_mark_shares for delete to authenticated
  using (shared_by = (select auth.uid()));

create or replace function can_view_shared_mark(target_mark_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.channel_mark_shares shares
    join public.channel_members members on members.channel_id = shares.channel_id
    where shares.mark_id = target_mark_id and members.user_id = auth.uid()
  )
$$;

revoke all on function can_view_shared_mark(uuid) from public, anon;
grant execute on function can_view_shared_mark(uuid) to authenticated;

create policy watch_marks_select_shared_channel
  on watch_marks for select to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and can_view_shared_mark(id)
  );

create or replace function create_watch_mark_with_defaults(
  target_window_start date,
  target_showing_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_mark_id uuid;
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.watch_marks (user_id, window_start, showing_id)
  values (caller_id, target_window_start, target_showing_id)
  on conflict (user_id, window_start, showing_id) do update
    set showing_id = excluded.showing_id
  returning id into new_mark_id;

  insert into public.channel_mark_shares (channel_id, mark_id, shared_by)
  select channel_id, new_mark_id, caller_id
  from public.channel_members
  where user_id = caller_id and auto_share_new_marks
  on conflict (channel_id, mark_id) do nothing;

  return new_mark_id;
end;
$$;

create or replace function set_watch_mark_channels(
  target_mark_id uuid,
  target_channel_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.watch_marks
    where id = target_mark_id and user_id = auth.uid()
  ) then
    raise exception 'Watch mark not found.' using errcode = 'insufficient_privilege';
  end if;

  delete from public.channel_mark_shares
  where mark_id = target_mark_id
    and shared_by = auth.uid()
    and not (channel_id = any(coalesce(target_channel_ids, '{}'::uuid[])));

  insert into public.channel_mark_shares (channel_id, mark_id, shared_by)
  select members.channel_id, target_mark_id, auth.uid()
  from public.channel_members members
  where members.user_id = auth.uid()
    and members.channel_id = any(coalesce(target_channel_ids, '{}'::uuid[]))
  on conflict (channel_id, mark_id) do nothing;
end;
$$;

create or replace function set_channel_auto_share(
  target_channel_id uuid,
  enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.channel_members
  set auto_share_new_marks = enabled
  where channel_id = target_channel_id and user_id = auth.uid();
  if not found then
    raise exception 'Channel membership not found.' using errcode = 'insufficient_privilege';
  end if;
end;
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
  select
    marks.id,
    marks.window_start,
    marks.showing_id,
    marks.user_id,
    profiles.username,
    shares.created_at
  from public.channel_mark_shares shares
  join public.watch_marks marks on marks.id = shares.mark_id
  join public.profiles on profiles.id = marks.user_id
  where shares.channel_id = target_channel_id
    and public.is_channel_member(target_channel_id)
  order by shares.created_at desc
$$;

revoke all on function create_watch_mark_with_defaults(date, text) from public, anon;
revoke all on function set_watch_mark_channels(uuid, uuid[]) from public, anon;
revoke all on function set_channel_auto_share(uuid, boolean) from public, anon;
revoke all on function list_channel_shared_marks(uuid) from public, anon;
grant execute on function create_watch_mark_with_defaults(date, text) to authenticated;
grant execute on function set_watch_mark_channels(uuid, uuid[]) to authenticated;
grant execute on function set_channel_auto_share(uuid, boolean) to authenticated;
grant execute on function list_channel_shared_marks(uuid) to authenticated;

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
  if not exists (select 1 from public.channel_guests where id = target_guest_id) then
    return null;
  end if;
  if (
    select count(*) >= 5 from public.channel_guest_access_attempts
    where guest_id = target_guest_id and not succeeded
      and attempted_at > now() - interval '15 minutes'
  ) then
    return null;
  end if;
  select channel_id into target_channel_id
  from public.channel_guests
  where id = target_guest_id and revoked_at is null
    and access_code_hash = extensions.digest(access_code, 'sha256');
  insert into public.channel_guest_access_attempts (guest_id, succeeded)
  values (target_guest_id, target_channel_id is not null);
  if target_channel_id is null then return null; end if;
  update public.channel_guests set last_accessed_at = now() where id = target_guest_id;

  select jsonb_build_object(
    'channel', jsonb_build_object('id', channels.id, 'name', channels.name),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('username', profiles.username, 'role', members.role) order by members.joined_at)
      from public.channel_members members join public.profiles on profiles.id = members.user_id
      where members.channel_id = channels.id
    ), '[]'::jsonb),
    'guests', coalesce((
      select jsonb_agg(jsonb_build_object('name', guests.display_name) order by guests.created_at)
      from public.channel_guests guests
      where guests.channel_id = channels.id and guests.revoked_at is null
    ), '[]'::jsonb),
    'sharedMarks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'windowStart', marks.window_start,
        'showingId', marks.showing_id,
        'username', profiles.username
      ) order by shares.created_at desc)
      from public.channel_mark_shares shares
      join public.watch_marks marks on marks.id = shares.mark_id
      join public.profiles on profiles.id = marks.user_id
      where shares.channel_id = channels.id
    ), '[]'::jsonb)
  ) into result
  from public.channels where channels.id = target_channel_id;
  return result;
end;
$$;

revoke all on function read_channel_as_guest(uuid, text) from public, anon, authenticated;
grant execute on function read_channel_as_guest(uuid, text) to service_role;
