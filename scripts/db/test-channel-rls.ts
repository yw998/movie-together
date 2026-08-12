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
    await resetIdentity();

    await assumeIdentity(outsiderId);
    const outsiderRows = await transaction`select id from channels where id = ${channelId}::uuid`;
    assert(outsiderRows.length === 0, "Outsider can read a private channel.");
    const outsiderProfileRows = await transaction`
      select username from profiles where id = ${existingUser.id}::uuid
    `;
    assert(outsiderProfileRows.length === 0, "Outsider can read a channel member profile.");
    await resetIdentity();

    const [privileges] = await transaction<{
      authenticated_member_insert: boolean;
      anon_channel_select: boolean;
      anon_guest_create: boolean;
      authenticated_guest_create: boolean;
      service_guest_create: boolean;
    }[]>`
      select
        has_table_privilege('authenticated', 'channel_members', 'INSERT') as authenticated_member_insert,
        has_table_privilege('anon', 'channels', 'SELECT') as anon_channel_select,
        has_function_privilege('anon', 'create_channel_guest(text,text)', 'EXECUTE') as anon_guest_create,
        has_function_privilege('authenticated', 'create_channel_guest(text,text)', 'EXECUTE') as authenticated_guest_create,
        has_function_privilege('service_role', 'create_channel_guest(text,text)', 'EXECUTE') as service_guest_create
    `;
    assert(!privileges.authenticated_member_insert, "Authenticated users can insert memberships directly.");
    assert(!privileges.anon_channel_select, "Anonymous users have direct channel-table access.");
    assert(!privileges.anon_guest_create, "Anonymous users can call the trusted guest creator.");
    assert(!privileges.authenticated_guest_create, "Authenticated users can call the trusted guest creator.");
    assert(privileges.service_guest_create, "The trusted service role cannot create a guest.");

    throw rollbackMarker;
  });
} catch (error) {
  if (error !== rollbackMarker) throw error;
} finally {
  await sql.end();
}

console.log("Verified owner/outsider visibility and guest-service privilege boundaries; test data rolled back.");
