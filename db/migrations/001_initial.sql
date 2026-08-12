create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists cinemas (
  id text primary key,
  name text not null,
  official_url text not null check (official_url like 'https://%'),
  schedule_url text not null check (schedule_url like 'https://%'),
  timezone text not null check (timezone = 'America/New_York'),
  enabled boolean not null default true,
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order smallint not null unique
);

create table if not exists films (
  id text primary key,
  canonical_title text not null,
  display_title text not null,
  release_year integer check (release_year is null or release_year between 1888 and 2200),
  director text,
  runtime_minutes integer check (runtime_minutes is null or runtime_minutes > 0),
  description_zh text,
  description_source text
);

create table if not exists ingestion_runs (
  id text primary key,
  generated_at timestamptz not null unique,
  window_start date not null,
  window_end date not null,
  timezone text not null check (timezone = 'America/New_York'),
  window_kind text not null check (window_kind = 'calendar_week_monday_sunday'),
  created_at timestamptz not null default now(),
  check (window_end = window_start + 6)
);

create table if not exists source_snapshots (
  run_id text not null references ingestion_runs(id) on delete cascade,
  cinema_id text not null references cinemas(id),
  fetched_at timestamptz not null,
  source_url text not null check (source_url like 'https://%'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  result text not null check (result in ('success', 'partial', 'failed')),
  error text,
  warnings jsonb not null default '[]'::jsonb,
  primary key (run_id, cinema_id)
);

create table if not exists schedule_weeks (
  window_start date primary key,
  window_end date not null,
  timezone text not null check (timezone = 'America/New_York'),
  refreshed_local_date date not null,
  provenance_note text not null,
  run_id text not null references ingestion_runs(id),
  check (window_end = window_start + 6)
);

create table if not exists schedule_films (
  window_start date not null references schedule_weeks(window_start) on delete cascade,
  film_id text not null references films(id),
  primary key (window_start, film_id)
);

create table if not exists showings (
  window_start date not null references schedule_weeks(window_start) on delete cascade,
  id text not null,
  cinema_id text not null references cinemas(id),
  film_id text not null references films(id),
  starts_at timestamptz not null,
  local_date date not null,
  local_time time without time zone not null,
  format text check (format is null or format in ('35mm', '70mm', '16mm', 'DCP', '4K DCP')),
  event_type text not null check (event_type in ('standard', 'qa', 'intro', 'members_only', 'open_caption', 'other')),
  event_note text,
  detail_url text not null check (detail_url like 'https://%'),
  ticket_url text check (ticket_url is null or ticket_url like 'https://%'),
  availability text not null check (availability in ('available', 'sold_out', 'unknown')),
  source_url text not null check (source_url like 'https://%'),
  fetched_at timestamptz not null,
  extraction_status text not null check (extraction_status in ('verified', 'manual')),
  primary key (window_start, id),
  foreign key (window_start, film_id) references schedule_films(window_start, film_id),
  check (local_date between window_start and window_start + 6)
);

create index if not exists showings_date_time_idx on showings(window_start, local_date, local_time);
create index if not exists showings_cinema_idx on showings(window_start, cinema_id);
create index if not exists showings_film_idx on showings(film_id);

create table if not exists manual_overrides (
  id bigint generated always as identity primary key,
  run_id text not null references ingestion_runs(id) on delete cascade,
  window_start date not null references schedule_weeks(window_start) on delete cascade,
  operation text not null check (operation in ('remove', 'upsert')),
  showing_id text,
  source_url text not null check (source_url like 'https://%'),
  reason text not null check (length(reason) >= 8),
  entered_at timestamptz not null,
  resolves_warnings jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  unique (run_id, operation, showing_id, entered_at)
);

create table if not exists review_reports (
  candidate_digest text primary key check (candidate_digest ~ '^[0-9a-f]{64}$'),
  run_id text not null references ingestion_runs(id),
  generated_at timestamptz not null,
  publishable boolean not null,
  approval_required boolean not null check (approval_required),
  summary jsonb not null,
  report jsonb not null
);

create table if not exists approvals (
  candidate_digest text primary key references review_reports(candidate_digest),
  report_generated_at timestamptz not null,
  approved_at timestamptz not null,
  approved_by text not null check (length(trim(approved_by)) > 0),
  decision text not null check (decision = 'approved'),
  reviewed_summary jsonb not null
);

create table if not exists published_weeks (
  window_start date primary key references schedule_weeks(window_start),
  candidate_digest text not null references approvals(candidate_digest),
  published_at timestamptz not null default now(),
  is_current boolean not null default false
);

create unique index if not exists published_weeks_one_current_idx
  on published_weeks(is_current) where is_current;

create table if not exists workflow_artifacts (
  run_id text not null references ingestion_runs(id) on delete cascade,
  kind text not null check (kind in ('candidate', 'compiled_schedule', 'review_bundle', 'review_report', 'approval', 'manual_overrides')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, kind)
);
