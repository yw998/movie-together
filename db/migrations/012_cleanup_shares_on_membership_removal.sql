create or replace function cleanup_channel_member_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.channel_mark_shares
  where channel_id = old.channel_id and shared_by = old.user_id;
  return old;
end;
$$;

revoke all on function cleanup_channel_member_shares() from public, anon, authenticated;

create trigger channel_members_cleanup_shares
before delete on channel_members
for each row execute function cleanup_channel_member_shares();
