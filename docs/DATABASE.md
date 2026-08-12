# PostgreSQL data workflow

## Architecture

Supabase PostgreSQL is the durable system of record. The browser never connects
to PostgreSQL and receives no database credential. The approved current week is
exported to `src/data/published-schedule.json` during the controlled publication
workflow, allowing the public site to remain a fast static build.

The database retains both normalized relational data and immutable workflow
artifacts:

- `cinemas`, `films`, `schedule_weeks`, `schedule_films`, `showings`
- `ingestion_runs`, `source_snapshots`
- `manual_overrides`
- `review_reports`, `approvals`, `published_weeks`
- `workflow_artifacts` for candidate, compiled schedule, review bundle, report,
  approval, and override JSON
- `schema_migrations`

## Security

- `DATABASE_URL` exists only in `.env.local`, which is ignored by Git.
- Database variables must never use the `VITE_` prefix.
- Server-managed schedule and audit tables have Row Level Security enabled with
  no browser policy, and their table/sequence privileges are revoked from
  Supabase `anon` and `authenticated` roles.
- Authenticated user tables use explicit owner-only policies and the minimum
  required table privileges. Anonymous users receive no user-table privileges.
- The static frontend uses exported JSON and does not use Supabase public or
  service-role API keys.

This describes the current public schedule. The planned account features will
add a Supabase browser client for authenticated, user-scoped tables only. The
official weekly schedule will continue to use the server-side import/export
path and will not become browser-writable.

## Planned authenticated application data

The confirmed product direction includes accounts, private showing-level watch marks,
invite-only channels, explicit sharing, and user-created events. The planned
tables are:

- `profiles`
- `channels`, `channel_members`, `channel_invitations`
- `watch_marks`
- `user_events`
- `channel_mark_shares`, `channel_event_shares`

Official films/showings and user-created events must remain separate. A user
event is never official source evidence and must be visibly labeled as
user-created in the UI.

The security model is deny-by-default Row Level Security:

- owners can manage their own marks and user events;
- active channel members can read explicitly shared items;
- channel readers cannot edit or delete another user's item;
- only an item's owner can create or remove its share records;
- channel membership and invitation acceptance are validated in the database or
  trusted server code, never by trusting a client-supplied owner ID;
- removing membership immediately removes channel-derived read access.

Each `watch_marks` row targets one exact official showing, not a film in
general. The reference therefore needs the showing's stable database identity
(currently the composite `window_start` + showing `id`). Before watch marks are
enabled, the approved-week importer must stop deleting and recreating all rows
for the week. It must upsert stable showing occurrences and preserve referenced
rows when an upstream event disappears, with an explicit removed/cancelled
state where appropriate. A refresh must never silently orphan or erase a user's
mark.

Implementation must include multi-user RLS tests before these tables are used by
the production frontend. Supabase publishable keys may be exposed to the browser
only after the policies are in place; `DATABASE_URL` and service-role credentials
remain secret.

## Setup

Copy `.env.example` to `.env.local` and set the Supabase Session Pooler URI:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
```

Apply pending migrations:

```text
npm run db:migrate
```

Verify the account/watch-mark schema without reading user content:

```text
npm run db:verify-user-schema
```

## Approved import

The importer independently recompiles the source candidate, applies the exact
override file, verifies the review and approval SHA-256 digest, then writes all
relational and audit data in one transaction.

```text
npm run db:import -- candidate.json compiled.json review-bundle.json overrides.json report.json approval.json
```

If any constraint or digest check fails, the transaction is rolled back.

## Frontend export

Export the database's current approved week:

```text
npm run db:export -- src/data/published-schedule.json
```

Verify a newly generated export against its approved compiled schedule:

```text
npm run db:verify-export -- approved-schedule.json exported-schedule.json
```

The verifier compares metadata, cinemas, films, showings, provenance, and local
times while treating equivalent timestamp offset representations as the same
instant.

Inspect non-sensitive row counts:

```text
npm run db:status
```

Always run `npm test` and `npm run build` after exporting public data.

## Current database state — 2026-08-11

- Current week: August 10–16, 2026
- Cinemas: 6
- Films: 107
- Showings: 404
- Source snapshots: 6
- Manual overrides: 1
- Review reports: 1
- Approvals: 1
- Workflow artifacts: 6
- Database round-trip verification: passed
- Account foundation: `profiles` and exact-showing `watch_marks` schema ready;
  frontend authentication is not enabled yet
