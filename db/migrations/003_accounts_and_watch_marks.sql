alter table showings
  add column if not exists publication_status text not null default 'active'
  check (publication_status in ('active', 'removed'));

create index if not exists showings_publication_status_idx
  on showings(window_start, publication_status, starts_at);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (
    length(trim(display_name)) between 1 and 80
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function set_profile_updated_at() from public;

create trigger profiles_set_updated_at
before update on profiles
for each row execute function set_profile_updated_at();

create table if not exists watch_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  window_start date not null,
  showing_id text not null,
  created_at timestamptz not null default now(),
  foreign key (window_start, showing_id)
    references showings(window_start, id) on delete restrict,
  unique (user_id, window_start, showing_id)
);

create index if not exists watch_marks_user_created_idx
  on watch_marks(user_id, created_at desc);

alter table profiles enable row level security;
alter table watch_marks enable row level security;

revoke all on table profiles from anon, authenticated;
revoke all on table watch_marks from anon, authenticated;

grant select, insert, delete on table profiles to authenticated;
grant update (display_name) on table profiles to authenticated;
grant select, insert, delete on table watch_marks to authenticated;

create policy profiles_select_own
  on profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_insert_own
  on profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_update_own
  on profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy profiles_delete_own
  on profiles for delete to authenticated
  using ((select auth.uid()) = id);

create policy watch_marks_select_own
  on watch_marks for select to authenticated
  using ((select auth.uid()) = user_id);

create policy watch_marks_insert_own
  on watch_marks for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy watch_marks_delete_own
  on watch_marks for delete to authenticated
  using ((select auth.uid()) = user_id);
