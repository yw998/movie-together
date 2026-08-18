alter table profiles
  add column if not exists preferred_locale text
  check (preferred_locale in ('zh-CN', 'en-US'));

grant update (preferred_locale) on table profiles to authenticated;

alter table films
  add column if not exists description_en text;
