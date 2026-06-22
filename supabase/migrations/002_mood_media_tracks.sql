-- Mood Lift media catalog (bhajans, meditation, jokes & fun, nature sounds)
-- Single normalized table with category discriminator.

create table if not exists public.mood_media_tracks (
  id               uuid        primary key default gen_random_uuid(),
  category         text        not null
                               check (category in ('bhajans', 'meditation', 'jokes_fun', 'nature_sounds')),
  title            text        not null,
  subtitle         text,
  duration_seconds integer     check (duration_seconds is null or duration_seconds > 0),
  duration_label   text,
  icon_name        text,
  icon_url         text,
  audio_url        text        not null,
  sort_order       integer     not null default 0,
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint mood_media_tracks_category_title_unique unique (category, title)
);

create index if not exists mood_media_tracks_category_active_sort_idx
  on public.mood_media_tracks (category, is_active, sort_order);

create table if not exists public.mood_media_favorites (
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  track_id   uuid        not null references public.mood_media_tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create index if not exists mood_media_favorites_user_idx
  on public.mood_media_favorites (user_id);

-- updated_at trigger (idempotent)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mood_media_tracks_updated_at on public.mood_media_tracks;
create trigger mood_media_tracks_updated_at
  before update on public.mood_media_tracks
  for each row execute function public.set_updated_at();

alter table public.mood_media_tracks enable row level security;
alter table public.mood_media_favorites enable row level security;

-- Catalog: read-only for clients; content managed via migrations / service role.
drop policy if exists "mood_media_tracks_select_active" on public.mood_media_tracks;
create policy "mood_media_tracks_select_active"
  on public.mood_media_tracks
  for select
  using (is_active = true);

drop policy if exists "mood_media_favorites_select_own" on public.mood_media_favorites;
create policy "mood_media_favorites_select_own"
  on public.mood_media_favorites
  for select
  using (auth.uid() = user_id);

drop policy if exists "mood_media_favorites_insert_own" on public.mood_media_favorites;
create policy "mood_media_favorites_insert_own"
  on public.mood_media_favorites
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "mood_media_favorites_delete_own" on public.mood_media_favorites;
create policy "mood_media_favorites_delete_own"
  on public.mood_media_favorites
  for delete
  using (auth.uid() = user_id);

-- Seed catalog (placeholder CDN URLs — replace with Supabase Storage or production CDN)
insert into public.mood_media_tracks
  (category, title, subtitle, duration_seconds, duration_label, icon_name, audio_url, sort_order)
values
  -- meditation
  ('meditation', 'Morning Calm',      'Guided · 5 min',           255, '4:15', 'sunny-outline',        'https://cdn.tinybit.app/mood-media/meditation/morning-calm.mp3',      1),
  ('meditation', 'Body Scan',         'Release tension gently',   600, '10:00', 'body-outline',         'https://cdn.tinybit.app/mood-media/meditation/body-scan.mp3',         2),
  ('meditation', 'Breath Focus',      'Simple breathing practice',420, '7:00',  'leaf-outline',         'https://cdn.tinybit.app/mood-media/meditation/breath-focus.mp3',      3),
  ('meditation', 'Sleep Wind-Down',   'Prepare for restful sleep',720, '12:00', 'moon-outline',         'https://cdn.tinybit.app/mood-media/meditation/sleep-wind-down.mp3',   4),
  ('meditation', 'Gratitude Moment',  'Reflect on the good things',360, '6:00',  'heart-outline',        'https://cdn.tinybit.app/mood-media/meditation/gratitude-moment.mp3',  5),
  ('meditation', 'Ease Anxiety',      'Gentle reassurance',       480, '8:00',  'cloud-outline',        'https://cdn.tinybit.app/mood-media/meditation/ease-anxiety.mp3',      6),

  -- bhajans
  ('bhajans', 'Vaishnav Jan To',      'Traditional',               390, '6:30', 'musical-note-outline',  'https://cdn.tinybit.app/mood-media/bhajans/vaishnav-jan-to.mp3',      1),
  ('bhajans', 'Hanuman Chalisa',      'Traditional',               525, '8:45', 'musical-note-outline',  'https://cdn.tinybit.app/mood-media/bhajans/hanuman-chalisa.mp3',      2),
  ('bhajans', 'Om Jai Jagdish Hare',  'Aarti',                     390, '6:30', 'musical-notes-outline', 'https://cdn.tinybit.app/mood-media/bhajans/om-jai-jagdish-hare.mp3', 3),
  ('bhajans', 'Gayatri Mantra',       'Sacred chant',              315, '5:15', 'heart-outline',         'https://cdn.tinybit.app/mood-media/bhajans/gayatri-mantra.mp3',       4),
  ('bhajans', 'Govind Bolo Hari',     'Krishna bhajan',            440, '7:20', 'musical-note-outline',  'https://cdn.tinybit.app/mood-media/bhajans/govind-bolo-hari.mp3',     5),
  ('bhajans', 'Om Namah Shivaya',     'Shiva mantra',              600, '10:00','heart-outline',         'https://cdn.tinybit.app/mood-media/bhajans/om-namah-shivaya.mp3',     6),

  -- nature_sounds
  ('nature_sounds', 'Mountain Stream', 'Water Flow',                900, '15:00', 'water-outline',       'https://cdn.tinybit.app/mood-media/nature-sounds/mountain-stream.mp3', 1),
  ('nature_sounds', 'Gentle Rain',     'Soft rainfall on leaves',   900, '15:00', 'rainy-outline',       'https://cdn.tinybit.app/mood-media/nature-sounds/gentle-rain.mp3',     2),
  ('nature_sounds', 'Ocean Waves',     'Steady seaside rhythm',    1200, '20:00', 'water-outline',       'https://cdn.tinybit.app/mood-media/nature-sounds/ocean-waves.mp3',    3),
  ('nature_sounds', 'Forest Birds',    'Morning woodland chorus',   720, '12:00', 'leaf-outline',        'https://cdn.tinybit.app/mood-media/nature-sounds/forest-birds.mp3',  4),
  ('nature_sounds', 'Flowing River',   'Peaceful stream sounds',   1080, '18:00', 'water-outline',       'https://cdn.tinybit.app/mood-media/nature-sounds/flowing-river.mp3', 5),
  ('nature_sounds', 'Soft Wind',       'Breeze through the trees',  840, '14:00', 'cloud-outline',       'https://cdn.tinybit.app/mood-media/nature-sounds/soft-wind.mp3',     6),

  -- jokes_fun
  ('jokes_fun', 'Papad Pol Jokes',     'Daily Fun',                  80, '1:20',  'happy-outline',        'https://cdn.tinybit.app/mood-media/jokes-fun/papad-pol-jokes.mp3',    1),
  ('jokes_fun', 'Doctor Visit',        'Why did the doctor carry a red pen?', 80, '1:20', 'happy-outline', 'https://cdn.tinybit.app/mood-media/jokes-fun/doctor-visit.mp3',      2),
  ('jokes_fun', 'Grandpa''s Wisdom',   'A funny story from the old days', 120, '2:00', 'chatbubble-outline', 'https://cdn.tinybit.app/mood-media/jokes-fun/grandpas-wisdom.mp3', 3),
  ('jokes_fun', 'Tea Time Tale',       'What did the teapot say to the cup?', 70, '1:10', 'cafe-outline', 'https://cdn.tinybit.app/mood-media/jokes-fun/tea-time-tale.mp3',     4),
  ('jokes_fun', 'Garden Giggles',      'Why do plants hate math?',   90, '1:30',  'leaf-outline',         'https://cdn.tinybit.app/mood-media/jokes-fun/garden-giggles.mp3',    5),
  ('jokes_fun', 'Monsoon Memories',    'Rain, umbrellas, and a little laughter', 105, '1:45', 'rainy-outline', 'https://cdn.tinybit.app/mood-media/jokes-fun/monsoon-memories.mp3', 6)
on conflict on constraint mood_media_tracks_category_title_unique do nothing;
