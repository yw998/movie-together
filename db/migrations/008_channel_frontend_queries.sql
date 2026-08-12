create or replace function list_my_channel_invitations()
returns table (
  invitation_id uuid,
  channel_id uuid,
  channel_name text,
  inviter_username text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invitations.id,
    invitations.channel_id,
    channels.name,
    profiles.username,
    invitations.expires_at
  from public.channel_invitations invitations
  join public.channels on channels.id = invitations.channel_id
  join public.profiles on profiles.id = invitations.invited_by
  where invitations.invited_user_id = auth.uid()
    and invitations.status = 'pending'
    and invitations.expires_at > now()
  order by invitations.created_at desc
$$;

revoke all on function list_my_channel_invitations() from public, anon;
grant execute on function list_my_channel_invitations() to authenticated;
