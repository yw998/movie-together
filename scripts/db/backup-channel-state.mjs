import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
  throw new Error("SUPABASE_PROJECT_REF is missing or invalid.");
}

const tables = [
  "schema_migrations",
  "channels",
  "channel_members",
  "channel_invitations",
  "channel_invite_links",
  "channel_guests",
  "channel_guest_access_attempts",
  "channel_guest_join_attempts",
  "channel_mark_shares",
  "channel_notification_reads",
];

const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const tableData = {};
  for (const table of tables) {
    const [{ exists }] = await sql.unsafe(
      "select to_regclass($1) is not null as exists",
      [`public.${table}`],
    );
    if (exists) tableData[table] = await sql.unsafe(`select * from public.${table}`);
  }

  const functions = await sql.unsafe(`
    select procedures.proname as procedure_name,
      pg_get_functiondef(procedures.oid) as definition
    from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and (procedures.proname like '%channel%' or procedures.proname like '%invitation%')
    order by procedures.proname, procedures.oid
  `);

  const createdAt = new Date().toISOString();
  const outputDirectory = resolve("data/backups");
  const outputPath = resolve(
    outputDirectory,
    `channel-state-${projectRef}-${createdAt.replaceAll(":", "-")}.json`,
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      { createdAt, projectRef, tables: tableData, functions },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
    { encoding: "utf8", flag: "wx" },
  );
  console.log(`Channel backup written to ${outputPath}`);
  console.log(
    Object.entries(tableData)
      .map(([table, rows]) => `${table}: ${rows.length}`)
      .join("\n"),
  );
} finally {
  await sql.end();
}
