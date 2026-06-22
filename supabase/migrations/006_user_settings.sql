-- Per-user app preferences (voice nav, vibration, fall detection, display prefs)

create table if not exists public.user_settings (
  user_id            uuid        primary key references public.profiles(id) on delete cascade,
  voice_navigation   boolean     not null default false,
  vibration_alerts   boolean     not null default true,
  fall_detection     boolean     not null default true,
  night_mode         boolean     not null default false,
  font_scale         numeric     not null default 1.0
                       check (font_scale >= 0.5 and font_scale <= 2.0),
  language           text        not null default 'en',
  updated_at         timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
  on public.user_settings for select
  using (auth.uid() = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
  on public.user_settings for update
  using (auth.uid() = user_id);

drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own"
  on public.user_settings for delete
  using (auth.uid() = user_id);

-- updated_at trigger (idempotent — function may exist from mood_media_tracks)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
