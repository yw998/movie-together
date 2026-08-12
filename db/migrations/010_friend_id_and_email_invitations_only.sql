create or replace function invite_channel_user_by_friend_id(
  target_channel_id uuid,
  target_friend_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_id uuid;
  invitation_id uuid;
begin
  if not public.is_channel_owner(target_channel_id) then
    raise exception 'Only the channel owner can invite users.' using errcode = 'insufficient_privilege';
  end if;

  select id into target_id
  from public.profiles
  where friend_id = upper(trim(target_friend_id));

  if target_id is null then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  if target_id = caller_id or exists (
    select 1 from public.channel_members
    where channel_id = target_channel_id and user_id = target_id
  ) then
    raise exception 'The user is already a channel member.' using errcode = 'unique_violation';
  end if;

  update public.channel_invitations
  set status = 'revoked', responded_at = now()
  where channel_id = target_channel_id
    and invited_user_id = target_id
    and status = 'pending';

  insert into public.channel_invitations (channel_id, invited_user_id, invited_by)
  values (target_channel_id, target_id, caller_id)
  returning id into invitation_id;
  return invitation_id;
end;
$$;

revoke all on function invite_channel_user_by_friend_id(uuid, text) from public, anon;
grant execute on function invite_channel_user_by_friend_id(uuid, text) to authenticated;

revoke execute on function invite_channel_user(uuid, text, text) from authenticated;
