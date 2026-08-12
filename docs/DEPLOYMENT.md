# GitHub and Vercel deployment

## Target architecture

- GitHub stores code and runs CI plus the weekly schedule workflow.
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
```

Use the Supabase Session Pooler URI. Do not add Supabase service-role or database
credentials to Vercel; the deployed static frontend does not need them.

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

## 4. Weekly automation behavior

`.github/workflows/weekly-schedule.yml` runs at the end of every Sunday—Monday
00:00 in `America/New_York`—and supports manual runs with an optional anchor
date. The Monday execution date becomes the anchor for the new Monday–Sunday
calendar week.

The job:

1. Applies database migrations.
2. Loads the current approved review bundle from PostgreSQL.
3. Pulls the official Monday–Sunday schedule.
4. Compiles, validates, deduplicates, and reviews changes.
5. Stops on any failed feed, unresolved warning, questionable count change,
   schema issue, database error, round-trip mismatch, test failure, or build
   failure.
6. Automatically approves only a report with zero concerns.
7. Imports the approved run into PostgreSQL in one transaction.
8. Exports the database publication to frontend JSON.
9. Runs tests and builds the site.
10. Commits the validated JSON; Vercel deploys that commit.

Every run uploads its candidate and review files as a private GitHub Actions
artifact for 30 days. A failed run opens a GitHub Issue and leaves the previous
database publication and Vercel deployment active. If a late step fails after
the database transaction, the previous Vercel deployment remains active and the
next run can safely export the database's current publication again.

## 5. First verification

After pushing the repository:

1. Open **Actions → Code quality** and confirm the test/build job passes.
2. Open **Actions → Weekly schedule publication → Run workflow**.
3. Enter a known anchor date or leave it empty for the current New York date.
4. Confirm a clean run updates Supabase and creates a Vercel deployment.
5. Test the Vercel URL on desktop and mobile before attaching a custom domain.

## Future accounts

The Vite frontend can later use Supabase Auth with a browser-safe project URL
and publishable key. User tables such as `profiles` and `favorites` must have
separate RLS policies keyed to `auth.uid()`. The server-only schedule and audit
tables remain inaccessible to browser roles. If authenticated SSR becomes
necessary, the frontend can migrate to Next.js on the same Vercel project while
retaining the existing Supabase database.
