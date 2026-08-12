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
no approved Chinese description in PostgreSQL or the curated catalog. You may
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
   rolling seven-day window from all six implemented cinemas.
4. Reuses cached Chinese descriptions and generates copy only for genuinely new
   films whose official detail pages contain sufficient evidence.
5. Compiles, validates, deduplicates, and reviews changes.
6. Stops on any failed feed, unresolved warning, questionable count change,
   schema issue, database error, round-trip mismatch, test failure, or build
   failure. Missing evidence, model refusal, or invalid Chinese copy also stops
   publication and opens the same manual-review path.
7. Automatically approves only a report with zero concerns.
8. Imports the approved run into PostgreSQL in one transaction, caching newly
   generated descriptions for later weeks.
9. Exports the database publication to frontend JSON.
10. Runs tests and builds the site.
11. Commits the validated JSON; Vercel deploys that commit.

Every run uploads its candidate and review files as a private GitHub Actions
artifact for 30 days. A failed run opens a GitHub Issue and leaves the previous
database publication and Vercel deployment active. If a late step fails after
the database transaction, the previous Vercel deployment remains active and the
next run can safely export the database's current publication again.

## 5. First verification

After pushing the repository:

1. Open **Actions → Code quality** and confirm the test/build job passes.
2. Open **Actions → Daily rolling schedule publication → Run workflow**.
3. Enter a known anchor date or leave it empty for the current New York date.
4. Confirm a clean run updates Supabase and creates a Vercel deployment.
5. Test the Vercel URL on desktop and mobile before attaching a custom domain.

## 6. Channel invitation Edge Function

Guest access and private-email lookup run in the `channel-invitations` Supabase
Edge Function. Supabase supplies its publishable and secret keys to the hosted
function; the secret key must never be copied to Vercel or a `VITE_*` variable.
The browser can call the function, but only its server-only database functions
can create guests, validate guest codes, or resolve Auth email addresses.

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
```

The function has JWT gateway verification disabled because invitation preview
and guest access are intentionally unauthenticated. It validates the bearer JWT
inside the function for private-email invitations, and the database grants all
four trusted functions only to `service_role`. Guest code and join attempts are
rate-limited in server-only tables.

## Future account rendering

The Vite frontend now uses Supabase Auth with a browser-safe project URL and
publishable key. User tables have explicit RLS policies keyed to `auth.uid()`;
the server-only schedule and audit tables remain inaccessible to browser roles.
If authenticated SSR becomes necessary, the frontend can migrate to Next.js on
the same Vercel project while retaining the existing Supabase database.
