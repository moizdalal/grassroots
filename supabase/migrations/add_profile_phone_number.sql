alter table public.profiles
  add column if not exists phone_number text;

notify pgrst, 'reload schema';
