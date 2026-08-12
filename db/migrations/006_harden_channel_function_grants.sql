revoke execute on function create_channel_guest(text, text) from anon, authenticated;

revoke execute on function create_channel(text) from anon;
revoke execute on function rotate_friend_id() from anon;
revoke execute on function get_my_friend_id() from anon;
revoke execute on function invite_channel_user(uuid, text, text) from anon;
revoke execute on function accept_channel_invitation(uuid) from anon;
revoke execute on function create_channel_invite_link(uuid) from anon;
revoke execute on function accept_channel_invite_link(text) from anon;
revoke execute on function revoke_channel_invite_link(uuid) from anon;
revoke execute on function leave_channel(uuid) from anon;
revoke execute on function remove_channel_member(uuid, uuid) from anon;
revoke execute on function delete_channel(uuid) from anon;

revoke execute on function is_channel_member(uuid) from anon;
revoke execute on function is_channel_owner(uuid) from anon;
revoke execute on function shares_channel_with(uuid) from anon;
