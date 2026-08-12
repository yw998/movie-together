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
begin
  if caller_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  if length(normalized_name) not between 1 and 80 then
    raise exception 'Channel name must be between 1 and 80 characters.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || lower(normalized_name), 0)
  );
  if exists (
    select 1 from public.channels
    where owner_user_id = caller_id
      and lower(trim(name)) = lower(normalized_name)
  ) then
    raise exception 'A channel with this name already exists.' using errcode = 'unique_violation';
  end if;

  insert into public.channels (owner_user_id, name)
  values (caller_id, normalized_name)
  returning id into new_channel_id;

  insert into public.channel_members (channel_id, user_id, role)
  values (new_channel_id, caller_id, 'owner');

  return new_channel_id;
end;
$$;

revoke all on function create_channel(text) from public, anon;
grant execute on function create_channel(text) to authenticated;
