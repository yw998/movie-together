alter table ingestion_runs
  drop constraint if exists ingestion_runs_window_kind_check;

alter table ingestion_runs
  add constraint ingestion_runs_window_kind_check
  check (window_kind in ('calendar_week_monday_sunday', 'rolling_seven_days'));

alter table schedule_weeks
  add column if not exists unavailable_cinema_dates jsonb not null default '[]'::jsonb;
