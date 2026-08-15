create or replace function get_my_account_summary()
returns table (
  marked_film_count bigint,
  group_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(distinct showings.film_id)
      from public.watch_marks marks
      join public.showings showings
        on showings.window_start = marks.window_start
       and showings.id = marks.showing_id
      where marks.user_id = auth.uid()
    ) as marked_film_count,
    (
      select count(*)
      from public.channel_members members
      where members.user_id = auth.uid()
    ) as group_count
$$;

revoke all on function get_my_account_summary() from public, anon;
grant execute on function get_my_account_summary() to authenticated;
