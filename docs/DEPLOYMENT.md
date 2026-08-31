# GitHub and Vercel deployment

## Target architecture

- GitHub stores code and runs CI plus the daily rolling schedule workflow.
- Supabase PostgreSQL stores normalized schedules and audit history.
- Vercel builds and serves the Vite frontend from the `main` branch.
- The frontend reads `src/data/published-schedule.json`; it never receives
  `DATABASE_URL`.

## 1. Create the GitHub repository

Create an empty GitHub repository named `movie-together`. Do not initialize it
with a README, license, or `.gitignore`, because those files already exist here.

From this project directory:

```text
git init -b main
git add .
git commit -m "Initial NYC repertory cinema application"
git remote add origin https://github.com/YOUR_ACCOUNT/movie-together.git
git push -u origin main
```

`.env.local`, `dist`, and local automation runs are ignored and must not appear
in the commit.

## 2. Configure GitHub Actions

In the repository, open **Settings → Secrets and variables → Actions** and add:

```text
DATABASE_URL
OPENAI_API_KEY
```

Use the Supabase Session Pooler URI. Do not add Supabase service-role or database
credentials to Vercel; the deployed static frontend does not need them.
`OPENAI_API_KEY` is read only by GitHub Actions. It is used only when a film has
a missing approved Chinese or English description in PostgreSQL or the curated catalog. You may
optionally add an Actions variable named `OPENAI_DESCRIPTION_MODEL`; otherwise
the workflow uses `gpt-5-mini`.

Under **Settings → Actions → General → Workflow permissions**, allow **Read and
write permissions** so the clean weekly job can commit only the validated public
JSON and create failure Issues.

Optionally create the repository label `schedule-review`. The workflow falls
back to an unlabeled Issue if the label does not exist.

## 3. Connect Vercel

1. Sign in to Vercel with GitHub.
2. Select **Add New → Project**.
3. Import `movie-together`.
4. Use these settings:

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Production Branch: main
```

5. Deploy.

`vercel.json` already records the framework, build command, and output directory.
Every validated weekly JSON commit to `main` will trigger a production build.
Pull requests receive Vercel preview deployments.

### Production username accounts

Accounts use username, password, and a one-time-displayed recovery code. No SMTP
or email template configuration is used. The trusted `account-auth` Edge
Function resolves usernames to random internal non-deliverable Supabase Auth
identifiers; the identifiers are not derived from public usernames.

Set the Vercel variables:

```text
VITE_TURNSTILE_SITE_KEY=YOUR_BROWSER_SAFE_SITE_KEY
```

Put `TURNSTILE_SECRET_KEY` only in the Supabase Edge Function environment. The
browser-safe site key remains in Vercel. Test normal login first, then trigger
three failed attempts and verify the adaptive challenge appears.

On Vercel Hobby, automated commits use the GitHub workflow actor as the commit
author so the deployment remains associated with the repository owner.

## 4. Daily rolling automation behavior

`.github/workflows/weekly-schedule.yml` runs every day at 05:00 in
`America/New_York` and supports manual runs with an optional rolling-window
start date. The public window is that New York date plus the following six days.
Storage and review remain Monday–Sunday: the job processes the one or two full
calendar weeks touched by the rolling window, then exports only the seven public
dates. This preserves stable watch-mark references across daily window changes.

The job:

1. Applies database migrations.
2. Loads the current approved review bundle from PostgreSQL.
3. Pulls the official schedule for each complete calendar week touched by the
   rolling seven-day window from all seven implemented cinemas. A clean cinema
   uses the current response. An unclean cinema is replaced atomically with its
   same-week previously approved facts; partial current facts are never mixed in.
4. Reuses cached Chinese and English descriptions. The daily schedule job is
   cache-only and does not request new AI copy.
5. Compiles, validates, deduplicates, and reviews changes.
6. Stops when an unclean feed has no same-week approved fallback, when fallback
   facts are stale, or on an unresolved warning from a current feed,
   questionable count change, schema issue, database error, round-trip
   mismatch, test failure, or build failure. Missing evidence, model refusal,
   or invalid Chinese copy also stops publication and opens the same
   manual-review path.
7. Automatically approves only a report with zero concerns.
8. Imports the approved run into PostgreSQL in one transaction, caching newly
   generated descriptions for later weeks.
9. Exports the database publication to frontend JSON.

### Hosted dry run

Manual workflow dispatch defaults to `dry_run: true`. In this mode the workflow
uses the same official-source adapters, PostgreSQL description cache, and
`OPENAI_API_KEY` as production, then compiles and reviews both calendar weeks
and verifies an isolated rolling candidate.

Dry-run mode skips database migrations, automatic approval, database import,
the public JSON export, git commits, deployment, and failure-issue creation. Its
private review artifacts are still uploaded for inspection. A manual dispatch
must explicitly turn off `dry_run` before it can follow the normal publication
path; scheduled daily runs continue to use the normal publication safety gates.
10. Runs tests and builds the site.
11. Commits the validated JSON; Vercel deploys that commit.

### Weekly bilingual description backfill

`.github/workflows/description-backfill.yml` runs every Monday at 06:30 in
`America/New_York`, after the daily schedule workflow. It finds missing Chinese
or English descriptions in the latest approved candidate, fetches official-page
evidence, generates only the missing languages, and validates each language
independently. Passing descriptions are written only to the film description
columns and synchronized into `src/data/published-schedule.json`; no cinema or
showing facts are changed. Review-needed and failed items remain unpublished and
are included in the private 30-day artifact. A total technical generation
failure stops the backfill before any import.

Manual runs remain available. Their `publish` input defaults to `false`, so a
manual run produces review artifacts without database, public JSON, commit, or
deployment changes unless publication is explicitly enabled.

Every run uploads its candidate and review files as a private GitHub Actions
artifact for 30 days. A failed run opens a GitHub Issue and leaves the previous
database publication and Vercel deployment active. If a late step fails after
the database transaction, the previous Vercel deployment remains active and the
next run can safely export the database's current publication again.

The artifact retains both `raw-candidate.json` and the reconciled
`candidate.json`. A review report marks `FALLBACK` for each cinema whose current
feed failed validation while its previously approved facts were carried
forward. The database source snapshot still records the current failed or
partial attempt; the carried showings keep their original `fetchedAt` and source
URLs.

### Resolve a description review without changing code

Description review failures do not mean that schedule facts are wrong. A year
in a synopsis may describe the story setting while another year describes an
award, premiere, or release. The generator is instructed to keep those semantic
roles separate, but genuinely ambiguous official copy still stops publication.

To resolve one yourself:

1. Open the failed Action log and copy the film ID and official evidence URL
   from the `Description enrichment needs manual review` error.
2. Read that official page and write one factual Chinese sentence of 12–90
   characters. Do not add facts that are absent from the page.
3. Edit `data/manual-description-overrides.json` in GitHub and add an entry:

```json
[
  {
    "filmId": "how-to-divorce-during-the-war",
    "canonicalTitle": "How to Divorce During the War",
    "descriptionZh": "（请替换为仅依据官方页面核实的一句中文影片简介）",
    "descriptionSource": "https://OFFICIAL-CINEMA-PAGE",
    "reason": "Confirmed that 2022 is the story setting, not an award year.",
    "createdAt": "2026-08-15T12:00:00-04:00"
  }
]
```

4. Commit the edit, then open **Actions → Daily rolling schedule publication →
   Run workflow**. First keep `dry_run` enabled. If it passes, run it again with
   `dry_run` disabled to publish.

The file is validated for duplicate film IDs, Chinese copy length, an official
cinema HTTPS source, and a valid timestamp. Its title must still match the current candidate,
so an old override cannot silently attach to a differently titled film. A
successful publication stores the reviewed description in PostgreSQL for reuse.

## 5. First verification

After pushing the repository:

1. Open **Actions → Code quality** and confirm the test/build job passes.
2. Open **Actions → Daily rolling schedule publication → Run workflow**.
3. Enter a known anchor date or leave it empty for the current New York date.
4. Confirm a clean run updates Supabase and creates a Vercel deployment.
5. Test the Vercel URL on desktop and mobile before attaching a custom domain.

## 6. Account and invitation Edge Functions

`account-auth` owns username signup, login, password changes, recovery,
recovery-code rotation, and account deletion. `channel-invitations` exposes invitation preview only;
authenticated acceptance uses the database RPC. Supabase supplies publishable
and secret keys to the hosted functions. Secret keys must never be copied to
Vercel or a `VITE_*` variable.

For a local deployment, create a Supabase personal access token at
`https://supabase.com/dashboard/account/tokens`, then add these to the ignored
`.env.local` file:

```env
SUPABASE_PROJECT_REF=YOUR_20_CHARACTER_PROJECT_REF
SUPABASE_ACCESS_TOKEN=sbp_YOUR_PERSONAL_ACCESS_TOKEN
```

Deploy without printing or passing the token on the command line:

```text
npm run functions:deploy
npm run functions:deploy:account
```

Both functions have gateway JWT verification disabled: invitation preview and
username login are intentionally available before authentication. Each function
exposes only its narrow server-side RPCs. Account attempts are rate-limited by
hashed IP fingerprint and username, and the service stores no plaintext recovery
code.

## 7. Unified-account production cutover

Do not run this sequence while account or Film Fam writes remain enabled.

1. Announce and enforce a short write pause.
2. Create a restorable database snapshot. Generate a random 32-byte hexadecimal
   `ACCOUNT_MIGRATION_BACKUP_KEY` and keep it outside the repository and
   deployment providers. If no managed backup or PITR restore point exists,
   create a PostgreSQL custom-format dump, encrypt it with
   `scripts/db/cutover-backup-crypto.mjs`, decrypt a temporary copy, and require
   both a matching SHA-256 hash and a successful full `pg_restore` read before
   deleting the plaintext copies.
3. Run `npm run db:inspect:account-cutover` and require a valid management token
   plus at least one completed managed backup or PITR. Apply the explicitly manual
   migration `023_unified_username_accounts.sql` with
   `npm run db:migrate:account-schema`. The normal `npm run db:migrate` command
   intentionally stops before this migration so schedule automation cannot perform
   a partial account cutover.
4. Run `npm run db:migrate:account-identifiers`. This replaces Auth identifiers
   and revokes every existing refresh session. Record the encrypted backup path
   and its `deleteBy` deadline.
5. Deploy `channel-invitations`, `account-auth`, and the frontend from the same
   release commit.
6. Run `npm run db:verify-user-schema`, `npm run db:test-channel-rls`, `npm test`,
   and `npm run build`. Manually verify existing login, new signup/recovery-code
   receipt, recovery, private marking, explicit sharing, link join, and deletion.
7. Keep writes paused until every check passes and the project's maximum access
   token lifetime has elapsed since step 4. Revoked refresh sessions cannot mint
   new tokens, but already-issued JWTs remain valid until their own expiry.
8. Resume writes.

If verification fails before writes resume, redeploy the previous frontend and
functions, roll back migration 023 using the database snapshot, then restore
Auth emails with `npm run db:rollback:account-identifiers -- BACKUP_PATH`. The
same external encryption key is required. Destroy the encrypted backup and key
no later than 30 days after a successful cutover and record that destruction.

## Future account rendering

The Vite frontend now uses Supabase Auth with a browser-safe project URL and
publishable key. User tables have explicit RLS policies keyed to `auth.uid()`;
the server-only schedule and audit tables remain inaccessible to browser roles.
If authenticated SSR becomes necessary, the frontend can migrate to Next.js on
the same Vercel project while retaining the existing Supabase database.
