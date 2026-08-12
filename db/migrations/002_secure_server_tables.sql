alter table schema_migrations enable row level security;
alter table cinemas enable row level security;
alter table films enable row level security;
alter table ingestion_runs enable row level security;
alter table source_snapshots enable row level security;
alter table schedule_weeks enable row level security;
alter table schedule_films enable row level security;
alter table showings enable row level security;
alter table manual_overrides enable row level security;
alter table review_reports enable row level security;
alter table approvals enable row level security;
alter table published_weeks enable row level security;
alter table workflow_artifacts enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
