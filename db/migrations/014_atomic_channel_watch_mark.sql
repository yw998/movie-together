create or replace function add_watch_mark_to_channel(
  target_window_start date,
  target_showing_id text,
  target_channel_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_mark_id uuid;
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.channel_members
    where channel_id = target_channel_id and user_id = caller_id
  ) then
    raise exception 'Channel membership not found.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.watch_marks (user_id, window_start, showing_id)
  values (caller_id, target_window_start, target_showing_id)
  on conflict (user_id, window_start, showing_id) do update
    set showing_id = excluded.showing_id
  returning id into target_mark_id;

  insert into public.channel_mark_shares (channel_id, mark_id, shared_by)
  values (target_channel_id, target_mark_id, caller_id)
  on conflict (channel_id, mark_id) do nothing;

  return target_mark_id;
end;
$$;

revoke all on function add_watch_mark_to_channel(date, text, uuid) from public, anon;
grant execute on function add_watch_mark_to_channel(date, text, uuid) to authenticated;
