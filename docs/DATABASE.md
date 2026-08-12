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
- All application tables have Row Level Security enabled with no public policy.
- Table and sequence privileges are revoked from Supabase `anon` and
  `authenticated` roles.
- The static frontend uses exported JSON and does not use Supabase public or
  service-role API keys.

## Setup

Copy `.env.example` to `.env.local` and set the Supabase Session Pooler URI:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
```

Apply pending migrations:

```text
npm run db:migrate
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
- Cinemas: 5
- Films: 89
- Showings: 342
- Source snapshots: 5
- Manual overrides: 1
- Review reports: 1
- Approvals: 1
- Workflow artifacts: 6
- Database round-trip verification: passed
