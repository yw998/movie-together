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
- `channel_invite_links`, `channel_guests`
- `watch_marks`
- `user_events`
- `channel_mark_shares`, `channel_event_shares`

Authentication v1 uses a unique lowercase username plus a private Supabase
email/password identity. Email remains in the protected Auth schema and is not
copied into `profiles`; profiles expose only `username`. Passwords require at
least eight characters. No real name, phone, birthday, contacts, or address is
requested. Channel invitations will use revocable links rather than exposing
member email addresses.

The signup UI includes an explicit confirmation-email resend action. Supabase's
built-in email provider is intended for initial testing and is rate-limited; an
earlier confirmation link remains usable for its configured validity period.
Production growth requires custom SMTP plus CAPTCHA rather than encouraging
users to submit the signup form repeatedly.
An `otp_expired` redirect is consumed by the account UI, shown as a recovery
message, and removed from the address bar. The user is routed to the resend form
instead of seeing an unexplained URL fragment.

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

The frontend reads only the signed-in user's marks for the current
`window_start`. Inserts omit `user_id` so PostgreSQL supplies `auth.uid()`; RLS
still verifies ownership. Deletion uses the mark UUID and remains owner-scoped.
The unique `(user_id, window_start, showing_id)` constraint prevents duplicate
marks. Channel share rows are not created by the private-mark UI.

## Planned channel identity and invitation security

Registered channel membership has two roles: `owner` and `member`. Direct
invitations can resolve an exact username, a random public Friend ID, or a
private Auth email. Email lookup must run in a trusted Edge Function/server
context because `auth.users` is never browser-readable. Its response must not
confirm whether an arbitrary email is registered. Username/Friend-ID lookup is
an exact-match RPC that returns only the minimum public profile fields.

Friend IDs are random, non-personal identifiers stored with a unique constraint;
they are separate from usernames and can be rotated. They must not be derived
from user UUIDs, emails, names, timestamps, or row counts.

Invitation URLs store only a token hash in `channel_invite_links`. The plaintext
token is returned once, can be revoked, has an expiry/use policy, and is not
written to logs. Acceptance is an atomic trusted operation that validates the
token before inserting membership.

An unauthenticated link visitor may register or create a `channel_guests` row
with a temporary display name. The guest receives a separate cryptographically
random access code; only its hash is stored. Guest authorization is
channel-scoped and must be enforced by a server endpoint rather than treating
the guest as a normal Supabase authenticated user. Code attempts are
rate-limited, and removing the guest immediately invalidates access.

Confirmed v1 behavior is read-only guest access. Invite links expire seven days
after creation, allow at most 20 successful joins, and can be revoked early by
the channel owner. If guests later own marks or events, those records need a
separate guest-owner model plus an explicit atomic
conversion process on registration; this must not be approximated by sharing a
normal user ID or weakening existing RLS.

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

The frontend account control requires these browser-safe Vite variables locally
and in Vercel:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

The publishable key is intentionally public and gains no access by itself; RLS
enforces user ownership. Never substitute the Supabase secret/service-role key.

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
- Account foundation, frontend authentication, password management, and private
  exact-showing watch marks are enabled
- Channel, membership, direct-invitation, link-invitation, Friend ID, and guest
  credential tables/functions are deployed; the production UI remains disabled
  until multi-user RLS tests and trusted email/guest endpoints are complete
- Trusted guest join/access and private-email invitation database functions are
  deployed with server-only rate-limit tables; the Edge Function and first
  account/guest Channel UI are deployed. A complete two-account acceptance test
  remains required before invitation handling is considered production-stable
