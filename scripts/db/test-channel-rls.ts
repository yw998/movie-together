import { createDatabaseClient } from "../../src/db/client";

const sql = createDatabaseClient();
const rollbackMarker = new Error("CHANNEL_RLS_TEST_ROLLBACK");
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  await sql.begin(async (transaction) => {
    const [owner] = await transaction<{ id: string }[]>`select id::text from auth.users order by created_at limit 1`;
    const [showing] = await transaction<{ window_start: string; id: string }[]>`
      select window_start::text, id from showings order by window_start desc, starts_at limit 1
    `;
    assert(owner && showing, "An Auth user and a showing are required for the RLS test.");

    async function assume(userId: string) {
      await transaction.unsafe("set local role authenticated");
      await transaction`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated", is_anonymous: false })}, true)`;
    }
    async function reset() { await transaction.unsafe("reset role"); }

    await assume(owner.id);
    const [{ create_channel: channelId }] = await transaction<{ create_channel: string }[]>`select create_channel('Unified account RLS test')`;
    const [invite] = await transaction<{ invite_token: string }[]>`select invite_token from create_channel_invite_link(${channelId}::uuid)`;
    const [{ create_watch_mark_with_defaults: markId }] = await transaction<{ create_watch_mark_with_defaults: string }[]>`
      select create_watch_mark_with_defaults(${showing.window_start}::date, ${showing.id})
    `;
    const privateRows = await transaction`select * from list_channel_shared_marks(${channelId}::uuid) where mark_id = ${markId}::uuid`;
    assert(privateRows.length === 0, "A new homepage mark was shared automatically.");
    await transaction`select set_watch_mark_channels(${markId}::uuid, array[${channelId}::uuid])`;
    const sharedRows = await transaction`select * from list_channel_shared_marks(${channelId}::uuid) where mark_id = ${markId}::uuid`;
    assert(sharedRows.length === 1, "An explicit group share is not visible to its owner.");
    await reset();

    await transaction.unsafe("set local role service_role");
    const [{ preview_channel_invite: preview }] = await transaction<{ preview_channel_invite: { channelId: string; memberCount: number } | null }[]>`
      select preview_channel_invite(${invite.invite_token})
    `;
    assert(preview?.channelId === channelId && preview.memberCount === 1, "Trusted invite preview is invalid.");
    await reset();

    const [{ outsiderId }] = await transaction<{ outsiderId: string }[]>`select gen_random_uuid()::text as "outsiderId"`;
    await assume(outsiderId);
    const outsiderChannels = await transaction`select id from channels where id = ${channelId}::uuid`;
    const outsiderShares = await transaction`select * from list_channel_shared_marks(${channelId}::uuid)`;
    assert(outsiderChannels.length === 0 && outsiderShares.length === 0, "An outsider can read a private group.");
    await reset();

    const [privileges] = await transaction<{ member_insert: boolean; anon_channels: boolean; recovery_read: boolean; tombstone_read: boolean }[]>`
      select
        has_table_privilege('authenticated', 'channel_members', 'INSERT') as member_insert,
        has_table_privilege('anon', 'channels', 'SELECT') as anon_channels,
        has_table_privilege('authenticated', 'account_recovery_credentials', 'SELECT') as recovery_read,
        has_table_privilege('authenticated', 'deleted_usernames', 'SELECT') as tombstone_read
    `;
    assert(!privileges.member_insert && !privileges.anon_channels && !privileges.recovery_read && !privileges.tombstone_read,
      "A direct-table authorization boundary is open.");
    throw rollbackMarker;
  });
} catch (error) {
  if (error !== rollbackMarker) throw error;
} finally {
  await sql.end();
}

console.log("Verified private marks, explicit sharing, trusted invite previews, and outsider isolation; test data rolled back.");
