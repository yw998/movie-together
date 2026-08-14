-- Give personal accounts and no-email group identities the same group activity feed.

create table public.channel_identity_notification_reads (
  identity_id uuid not null,
  channel_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (identity_id, channel_id),
  foreign key (identity_id, channel_id)
    references public.channel_identities(id, channel_id) on delete cascade,
  foreign key (channel_id) references public.channels(id) on delete cascade
);

alter table public.channel_identity_notification_reads enable row level security;
revoke all on table public.channel_identity_notification_reads from public, anon, authenticated;

drop function if exists public.list_my_channel_notifications();
create function public.list_my_channel_notifications()
returns table (
  channel_id uuid,
  channel_name text,
  window_start date,
  showing_id text,
  actor_names text[],
  actor_count integer,
  shared_at timestamptz,
  is_new boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with activity as (
    select shares.channel_id, marks.window_start, marks.showing_id,
      'account:' || marks.user_id::text as actor_key, profiles.username as actor_name,
      shares.created_at as shared_at
    from public.channel_mark_shares shares
    join public.watch_marks marks on marks.id = shares.mark_id
    join public.profiles on profiles.id = marks.user_id
    where marks.user_id <> auth.uid()
    union all
    select marks.channel_id, marks.window_start, marks.showing_id,
      'identity:' || marks.identity_id::text, identities.display_name, marks.created_at
    from public.channel_identity_marks marks
    join public.channel_identities identities on identities.id = marks.identity_id
  )
  select members.channel_id, channels.name, activity.window_start, activity.showing_id,
    array_agg(distinct activity.actor_name order by activity.actor_name),
    count(distinct activity.actor_key)::integer,
    max(activity.shared_at),
    bool_or(activity.shared_at > coalesce(reads.last_read_at, members.joined_at))
  from public.channel_members members
  join public.channels channels on channels.id = members.channel_id
  join activity on activity.channel_id = members.channel_id
  left join public.channel_notification_reads reads
    on reads.user_id = members.user_id and reads.channel_id = members.channel_id
  where members.user_id = auth.uid()
    and activity.shared_at >= now() - interval '14 days'
  group by members.channel_id, channels.name, activity.window_start, activity.showing_id
  order by max(activity.shared_at) desc
  limit 100
$$;

drop function if exists public.mark_my_channel_notifications_read();
create function public.mark_my_channel_notifications_read(target_channel_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.channel_notification_reads (user_id, channel_id, last_read_at)
  select auth.uid(), members.channel_id, now()
  from public.channel_members members
  where members.user_id = auth.uid()
    and (target_channel_id is null or members.channel_id = target_channel_id)
  on conflict (user_id, channel_id) do update
    set last_read_at = excluded.last_read_at
$$;

create function public.list_channel_identity_notifications(session_token text)
returns table (
  channel_id uuid,
  channel_name text,
  window_start date,
  showing_id text,
  actor_names text[],
  actor_count integer,
  shared_at timestamptz,
  is_new boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_identity as (
    select identities.id, identities.channel_id, identities.created_at
    from public.channel_identities identities
    where identities.id = public.authenticate_channel_identity(session_token)
  ), activity as (
    select shares.channel_id, marks.window_start, marks.showing_id,
      'account:' || marks.user_id::text as actor_key, profiles.username as actor_name,
      shares.created_at as shared_at
    from public.channel_mark_shares shares
    join public.watch_marks marks on marks.id = shares.mark_id
    join public.profiles on profiles.id = marks.user_id
    union all
    select marks.channel_id, marks.window_start, marks.showing_id,
      'identity:' || marks.identity_id::text, identities.display_name, marks.created_at
    from public.channel_identity_marks marks
    join public.channel_identities identities on identities.id = marks.identity_id
    where marks.identity_id <> public.authenticate_channel_identity(session_token)
  )
  select current_identity.channel_id, channels.name, activity.window_start, activity.showing_id,
    array_agg(distinct activity.actor_name order by activity.actor_name),
    count(distinct activity.actor_key)::integer,
    max(activity.shared_at),
    bool_or(activity.shared_at > coalesce(reads.last_read_at, current_identity.created_at))
  from current_identity
  join public.channels channels on channels.id = current_identity.channel_id
  join activity on activity.channel_id = current_identity.channel_id
  left join public.channel_identity_notification_reads reads
    on reads.identity_id = current_identity.id and reads.channel_id = current_identity.channel_id
  where activity.shared_at >= now() - interval '14 days'
  group by current_identity.channel_id, channels.name, activity.window_start, activity.showing_id
  order by max(activity.shared_at) desc
  limit 100
$$;

create function public.mark_channel_identity_notifications_read(session_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_identity_id uuid := public.authenticate_channel_identity(session_token);
declare target_channel_id uuid;
begin
  select channel_id into target_channel_id from public.channel_identities where id = target_identity_id;
  if target_channel_id is null then return false; end if;
  insert into public.channel_identity_notification_reads(identity_id, channel_id, last_read_at)
    values (target_identity_id, target_channel_id, now())
    on conflict (identity_id, channel_id) do update set last_read_at = excluded.last_read_at;
  return true;
end;
$$;

revoke all on function public.list_my_channel_notifications() from public, anon;
revoke all on function public.mark_my_channel_notifications_read(uuid) from public, anon;
revoke all on function public.list_channel_identity_notifications(text) from public, anon, authenticated;
revoke all on function public.mark_channel_identity_notifications_read(text) from public, anon, authenticated;

grant execute on function public.list_my_channel_notifications() to authenticated;
grant execute on function public.mark_my_channel_notifications_read(uuid) to authenticated;
grant execute on function public.list_channel_identity_notifications(text) to service_role;
grant execute on function public.mark_channel_identity_notifications_read(text) to service_role;
