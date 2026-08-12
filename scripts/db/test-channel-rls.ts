import { createDatabaseClient } from "../../src/db/client";

const sql = createDatabaseClient();
const rollbackMarker = new Error("CHANNEL_RLS_TEST_ROLLBACK");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  await sql.begin(async (transaction) => {
    const [existingUser] = await transaction<{ id: string }[]>`
      select id::text from auth.users order by created_at limit 1
    `;
    assert(existingUser, "At least one existing Auth user is required for the RLS test.");
    const [{ id: outsiderId }] = await transaction<{ id: string }[]>`
      select gen_random_uuid()::text as id
    `;
    const [showing] = await transaction<{ window_start: string; id: string }[]>`
      select window_start::text, id from showings order by window_start desc, starts_at limit 1
    `;
    assert(showing, "At least one showing is required for the sharing RLS test.");

    async function assumeIdentity(userId: string) {
      await transaction.unsafe("set local role authenticated");
      await transaction`
        select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ sub: userId, role: "authenticated", is_anonymous: false })},
          true
        )
      `;
    }

    async function resetIdentity() {
      await transaction.unsafe("reset role");
    }

    await assumeIdentity(existingUser.id);
    const [{ create_channel: channelId }] = await transaction<{ create_channel: string }[]>`
      select create_channel('Temporary RLS test')
    `;
    const ownerRows = await transaction`select id from channels where id = ${channelId}::uuid`;
    assert(ownerRows.length === 1, "Owner cannot read their channel.");
    const [inviteLink] = await transaction<{ invite_token: string }[]>`
      select invite_token from create_channel_invite_link(${channelId}::uuid)
    `;
    await transaction`select set_channel_auto_share(${channelId}::uuid, true)`;
    const [{ create_watch_mark_with_defaults: markId }] = await transaction<{ create_watch_mark_with_defaults: string }[]>`
      select create_watch_mark_with_defaults(${showing.window_start}::date, ${showing.id})
    `;
    const sharedRows = await transaction`
      select * from list_channel_shared_marks(${channelId}::uuid)
      where mark_id = ${markId}::uuid
    `;
    assert(sharedRows.length === 1, "Auto-share did not expose the new personal mark to its channel.");
    await resetIdentity();

    await transaction.unsafe("set local role service_role");
    const [{ preview_channel_invite: preview }] = await transaction<{ preview_channel_invite: { channelId: string } | null }[]>`
      select preview_channel_invite(${inviteLink.invite_token})
    `;
    assert(preview?.channelId === channelId, "Trusted invite preview cannot resolve a valid link.");
    const [guest] = await transaction<{ guest_id: string; access_code: string }[]>`
      select guest_id, access_code
      from create_channel_guest_limited(
        ${inviteLink.invite_token},
        'Temporary guest',
        ${"a".repeat(64)}
      )
    `;
    assert(guest?.guest_id, "Trusted guest creation failed for a valid link.");
    const [{ read_channel_as_guest: guestView }] = await transaction<{ read_channel_as_guest: { channel: { id: string }; sharedMarks: unknown[] } | null }[]>`
      select read_channel_as_guest(${guest.guest_id}::uuid, ${guest.access_code})
    `;
    assert(guestView?.channel.id === channelId, "A valid guest code cannot read its channel.");
    assert(guestView.sharedMarks.length === 1, "A valid guest cannot read shared marks in its channel.");
    await resetIdentity();

    await assumeIdentity(outsiderId);
    const outsiderRows = await transaction`select id from channels where id = ${channelId}::uuid`;
    assert(outsiderRows.length === 0, "Outsider can read a private channel.");
    const outsiderProfileRows = await transaction`
      select username from profiles where id = ${existingUser.id}::uuid
    `;
    assert(outsiderProfileRows.length === 0, "Outsider can read a channel member profile.");
    const outsiderSharedRows = await transaction`
      select * from list_channel_shared_marks(${channelId}::uuid)
    `;
    assert(outsiderSharedRows.length === 0, "Outsider can read a channel's shared marks.");
    await resetIdentity();

    const [privileges] = await transaction<{
      authenticated_member_insert: boolean;
      anon_channel_select: boolean;
      anon_guest_create: boolean;
      authenticated_guest_create: boolean;
      service_guest_create: boolean;
      anon_guest_read: boolean;
      authenticated_email_invite: boolean;
      service_guest_read: boolean;
      authenticated_share_update: boolean;
    }[]>`
      select
        has_table_privilege('authenticated', 'channel_members', 'INSERT') as authenticated_member_insert,
        has_table_privilege('anon', 'channels', 'SELECT') as anon_channel_select,
        has_function_privilege('anon', 'create_channel_guest(text,text)', 'EXECUTE') as anon_guest_create,
        has_function_privilege('authenticated', 'create_channel_guest(text,text)', 'EXECUTE') as authenticated_guest_create,
        has_function_privilege('service_role', 'create_channel_guest(text,text)', 'EXECUTE') as service_guest_create,
        has_function_privilege('anon', 'read_channel_as_guest(uuid,text)', 'EXECUTE') as anon_guest_read,
        has_function_privilege('authenticated', 'invite_channel_user_by_email(uuid,uuid,text)', 'EXECUTE') as authenticated_email_invite,
        has_function_privilege('service_role', 'read_channel_as_guest(uuid,text)', 'EXECUTE') as service_guest_read,
        has_table_privilege('authenticated', 'channel_mark_shares', 'UPDATE') as authenticated_share_update
    `;
    assert(!privileges.authenticated_member_insert, "Authenticated users can insert memberships directly.");
    assert(!privileges.anon_channel_select, "Anonymous users have direct channel-table access.");
    assert(!privileges.anon_guest_create, "Anonymous users can call the trusted guest creator.");
    assert(!privileges.authenticated_guest_create, "Authenticated users can call the trusted guest creator.");
    assert(privileges.service_guest_create, "The trusted service role cannot create a guest.");
    assert(!privileges.anon_guest_read, "Anonymous users can call the trusted guest reader directly.");
    assert(!privileges.authenticated_email_invite, "Authenticated users can bypass the trusted email endpoint.");
    assert(privileges.service_guest_read, "The trusted service role cannot read a channel as a guest.");
    assert(!privileges.authenticated_share_update, "Authenticated users can update share ownership rows.");

    throw rollbackMarker;
  });
} catch (error) {
  if (error !== rollbackMarker) throw error;
} finally {
  await sql.end();
}

console.log("Verified Channel sharing, owner/outsider visibility, guest reads, and service boundaries; test data rolled back.");
