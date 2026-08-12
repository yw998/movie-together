create table channel_notification_reads (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id),
  foreign key (channel_id, user_id)
    references channel_members(channel_id, user_id) on delete cascade
);

alter table channel_notification_reads enable row level security;
revoke all on table channel_notification_reads from anon, authenticated;
grant select, insert, update on table channel_notification_reads to authenticated;

create policy channel_notification_reads_select_own
  on channel_notification_reads for select to authenticated
  using (user_id = (select auth.uid()));

create policy channel_notification_reads_insert_own
  on channel_notification_reads for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy channel_notification_reads_update_own
  on channel_notification_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function list_my_channel_notifications()
returns table (
  channel_id uuid,
  channel_name text,
  mark_id uuid,
  window_start date,
  showing_id text,
  actor_username text,
  shared_at timestamptz,
  is_new boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    shares.channel_id,
    channels.name,
    shares.mark_id,
    marks.window_start,
    marks.showing_id,
    profiles.username,
    shares.created_at,
    shares.created_at > coalesce(reads.last_read_at, members.joined_at)
  from public.channel_members members
  join public.channels on channels.id = members.channel_id
  join public.channel_mark_shares shares on shares.channel_id = members.channel_id
  join public.watch_marks marks on marks.id = shares.mark_id
  join public.profiles on profiles.id = shares.shared_by
  left join public.channel_notification_reads reads
    on reads.user_id = members.user_id and reads.channel_id = members.channel_id
  where members.user_id = auth.uid()
    and shares.shared_by <> auth.uid()
    and shares.created_at >= now() - interval '30 days'
  order by shares.created_at desc
  limit 100
$$;

create or replace function mark_my_channel_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.channel_notification_reads (user_id, channel_id, last_read_at)
  select auth.uid(), members.channel_id, now()
  from public.channel_members members
  where members.user_id = auth.uid()
  on conflict (user_id, channel_id) do update
    set last_read_at = excluded.last_read_at
$$;

revoke all on function list_my_channel_notifications() from public, anon;
revoke all on function mark_my_channel_notifications_read() from public, anon;
grant execute on function list_my_channel_notifications() to authenticated;
grant execute on function mark_my_channel_notifications_read() to authenticated;
