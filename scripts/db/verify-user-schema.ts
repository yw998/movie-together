import { createDatabaseClient } from "../../src/db/client";

const sql = createDatabaseClient();
try {
  const [tables] = await sql<{ profiles: string | null; watch_marks: string | null }[]>`
    select
      to_regclass('public.profiles')::text as profiles,
      to_regclass('public.watch_marks')::text as watch_marks
  `;
  if (tables.profiles !== "profiles" || tables.watch_marks !== "watch_marks") {
    throw new Error("Expected profiles and watch_marks tables are missing.");
  }

  const [showingStatus] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'showings'
        and column_name = 'publication_status'
    ) as exists
  `;
  if (!showingStatus.exists) {
    throw new Error("showings.publication_status is missing.");
  }

  const rlsRows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity
    from pg_class
    where oid in ('public.profiles'::regclass, 'public.watch_marks'::regclass)
  `;
  if (rlsRows.length !== 2 || rlsRows.some((row) => !row.relrowsecurity)) {
    throw new Error("RLS is not enabled on every user table.");
  }

  const policies = await sql<{ policyname: string }[]>`
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'watch_marks')
  `;
  const expectedPolicies = [
    "profiles_delete_own",
    "profiles_insert_own",
    "profiles_select_own",
    "profiles_update_own",
    "watch_marks_delete_own",
    "watch_marks_insert_own",
    "watch_marks_select_own",
  ];
  const actualPolicies = new Set(policies.map((row) => row.policyname));
  const missingPolicies = expectedPolicies.filter((policy) => !actualPolicies.has(policy));
  if (missingPolicies.length > 0) {
    throw new Error(`Missing RLS policies: ${missingPolicies.join(", ")}`);
  }

  const foreignKeys = await sql<{ definition: string }[]>`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.watch_marks'::regclass
      and contype = 'f'
  `;
  const hasShowingReference = foreignKeys.some((row) =>
    row.definition.includes("FOREIGN KEY (window_start, showing_id)") &&
    row.definition.includes("REFERENCES showings(window_start, id)"),
  );
  if (!hasShowingReference) {
    throw new Error("watch_marks does not reference one exact showing.");
  }

  console.log("Verified profiles, showing-level watch marks, stable references, and RLS policies.");
} finally {
  await sql.end();
}
