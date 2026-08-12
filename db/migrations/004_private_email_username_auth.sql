alter table profiles rename column display_name to username;

alter table profiles drop constraint if exists profiles_display_name_check;
alter table profiles add constraint profiles_username_format_check
  check (username ~ '^[a-z0-9_]{3,24}$');
alter table profiles add constraint profiles_username_key unique (username);

revoke update on table profiles from authenticated;
grant update (username) on table profiles to authenticated;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := lower(trim(new.raw_user_meta_data ->> 'username'));
  if requested_username is null or requested_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'A valid username is required.' using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username);
  return new;
end;
$$;

revoke all on function handle_new_auth_user() from public;

create trigger auth_user_create_profile
after insert on auth.users
for each row execute function handle_new_auth_user();

drop policy profiles_select_own on profiles;
drop policy profiles_insert_own on profiles;
drop policy profiles_update_own on profiles;
drop policy profiles_delete_own on profiles;
drop policy watch_marks_select_own on watch_marks;
drop policy watch_marks_insert_own on watch_marks;
drop policy watch_marks_delete_own on watch_marks;

create policy profiles_select_own
  on profiles for select to authenticated
  using (
    (select auth.uid()) = id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

create policy profiles_insert_own
  on profiles for insert to authenticated
  with check (
    (select auth.uid()) = id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

create policy profiles_update_own
  on profiles for update to authenticated
  using (
    (select auth.uid()) = id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

create policy profiles_delete_own
  on profiles for delete to authenticated
  using (
    (select auth.uid()) = id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

create policy watch_marks_select_own
  on watch_marks for select to authenticated
  using (
    (select auth.uid()) = user_id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

create policy watch_marks_insert_own
  on watch_marks for insert to authenticated
  with check (
    (select auth.uid()) = user_id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );

create policy watch_marks_delete_own
  on watch_marks for delete to authenticated
  using (
    (select auth.uid()) = user_id and
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  );
