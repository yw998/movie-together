# NYC Repertory Cinema Week

Chinese-first seven-day schedule for selected New York repertory cinemas.

Development record: [Engineering worklog — 2026-08-11](docs/WORKLOG_2026-08-11.md)

Database operations: [PostgreSQL data workflow](docs/DATABASE.md)

Deployment and automation: [GitHub and Vercel deployment](docs/DEPLOYMENT.md)

## Commands

- `npm install` — install dependencies
- `npm run dev` — start the local Vite server
- `npm test` — run the test suite once
- `npm run build` — type-check and create the production build
- `npm run db:migrate` — apply pending PostgreSQL migrations
- `npm run db:status` — show non-sensitive database row counts
- `npm run db:import -- candidate.json compiled.json review-bundle.json overrides.json report.json approval.json` — transactionally import an approved week and its audit history
- `npm run db:export -- output.json` — export the current approved database week for the static frontend
- `npm run db:verify-export -- approved.json exported.json` — verify relational round-trip equivalence
- `npm run ingest:week -- YYYY-MM-DD candidate.json` — run all implemented official adapters for that Monday–Sunday week and save an immutable candidate
- `npm run compile:candidate -- candidate.json schedule.json review-bundle.json [overrides.json]` — compile normalized facts and review input without publishing
- `npm run review:schedule -- previous.json current.json [report.json] [report.md]` — compare two compiled ingestion bundles and save approval/review artifacts
- `npm run approve:schedule -- report.json reviewer approval.json` — record explicit human approval for a clean report
- `npm run promote:schedule -- candidate.json approval.json src/data/published-schedule.json [overrides.json]` — replace public data only when the approval digest matches the recompiled facts

## Data status

The initial 409-showing dataset in `src/data/legacy-schedule.json` was recovered from the deployed prototype dated August 11, 2026. It preserves the existing UI content but is not equivalent to official-source evidence. The normalization layer therefore sets `fetchedAt` to `null` and `extractionStatus` to `needs_review` for every showing.

Supabase PostgreSQL is the durable system of record. The frontend reads an
approved static export at `src/data/published-schedule.json`. It contains
the approved official August 10–16 schedule: 89 films and 342 showings across
five cinemas. The recovered prototype remains separately archived in
`src/data/legacy-schedule.json`.

## Ingestion status

- Film Forum: official `my.filmforum.org` JSON adapter implemented. It uses explicit offset-bearing performance timestamps, direct ticket URLs, extraction status, content hashing, and visible failure results.
- IFC Center: official server-rendered HTML adapter implemented. It uses explicit AM/PM showtimes and direct ticket event IDs, and only attaches special-event captions when date/title/time resolve uniquely.
- Roxy Cinema: official Now Showing HTML adapter implemented. It uses offset-bearing screening datetimes and Veezi purchase IDs, preserves film-format labels, and applies dated introductions only to matching dates.
- Metrograph: official film-page HTML adapter implemented. It resolves yearless official date labels only within the requested window, retains Vista session IDs and film formats, and preserves sold-out sessions without inventing ticket URLs.
- Paris Theater: official digital showtime API plus CMS adapter implemented. It discovers the current public client contract at runtime (without persisting its client values), joins stable showtime IDs to official film metadata, and retains sold-out and accessibility/event labels.
- Remaining cinema adapters: Lincoln Center and Syndicated are not yet implemented.

The review command expects each JSON file to contain `generatedAt` and an
`adapters` array of serialized adapter results. It exits non-zero when a feed
failed or became partial, unresolved parser warnings exist, IDs are duplicated,
records still need review, a cinema disappears, a feed becomes empty, or its showing count
falls by more than 25%. Additions, removals, and factual changes are always
listed for human review.

Schedule windows are Monday through Sunday. A concern-free report is only
`READY FOR APPROVAL`; it is never automatic permission to publish. Approval
requires a named reviewer and produces a new audit artifact without overwriting
an existing file. Sold-out screenings remain in public data and are displayed
with an `已售罄` label.

The August 10–16 review is at
[`data/reviews/2026-08-10-v3-report.md`](data/reviews/2026-08-10-v3-report.md).
It covers 342 showings and has no remaining concerns. Its candidate digest is
`c2948efb2b8dcd909bebf82ca47a3441c9e6fd3168150a849efc2a4022b11b0d`.
Yuzhen Wang approved that digest, and the guarded promotion completed locally.

The approved schedule and its complete audit chain have also been imported into
Supabase PostgreSQL. Browser/API access to the server-managed tables is blocked;
the frontend continues to receive only the validated static JSON export.
