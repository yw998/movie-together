create or replace function accept_channel_invitation(
  target_invitation_id uuid,
  share_existing_marks boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_channel_id uuid;
begin
  target_channel_id := public.accept_channel_invitation(target_invitation_id);

  if coalesce(share_existing_marks, false) then
    insert into public.channel_mark_shares (channel_id, mark_id, shared_by)
    select target_channel_id, marks.id, auth.uid()
    from public.watch_marks marks
    where marks.user_id = auth.uid()
    on conflict (channel_id, mark_id) do nothing;
  end if;

  return target_channel_id;
end;
$$;

create or replace function accept_channel_invite_link(
  invite_token text,
  share_existing_marks boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_channel_id uuid;
begin
  target_channel_id := public.accept_channel_invite_link(invite_token);

  if coalesce(share_existing_marks, false) then
    insert into public.channel_mark_shares (channel_id, mark_id, shared_by)
    select target_channel_id, marks.id, auth.uid()
    from public.watch_marks marks
    where marks.user_id = auth.uid()
    on conflict (channel_id, mark_id) do nothing;
  end if;

  return target_channel_id;
end;
$$;

revoke all on function accept_channel_invitation(uuid, boolean) from public, anon;
revoke all on function accept_channel_invite_link(text, boolean) from public, anon;
grant execute on function accept_channel_invitation(uuid, boolean) to authenticated;
grant execute on function accept_channel_invite_link(text, boolean) to authenticated;
