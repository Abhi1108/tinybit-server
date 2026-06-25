-- TinyBit backend schema contract.
-- Run this in Supabase SQL editor or through your migration pipeline.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  full_name text,
  email text unique,
  mobile text,
  role text not null default 'elder' check (role in ('elder', 'guardian', 'caregiver', 'admin')),
  date_of_birth date,
  age integer,
  country text,
  country_code text,
  location text,
  preferred_language text,
  profile_image text,
  blood_group text,
  height numeric,
  height_unit text,
  weight numeric,
  weight_unit text,
  biological_sex text,
  medical_conditions text[],
  emergency_phone text,
  emergency_name text,
  emergency_relation text,
  family_code text unique,
  push_token text,
  plan_type text not null default 'free',
  plan_status text not null default 'active',
  plan_started_at timestamptz,
  plan_expires_at timestamptz,
  plan_amount numeric,
  plan_currency text not null default 'INR',
  plan_interval text,
  streak integer not null default 0,
  is_banned boolean not null default false,
  last_active timestamptz,
  health_qr_token text,
  health_qr_expires_at timestamptz,
  allergies text[],
  other_condition text,
  doctor_name text,
  doctor_contact text,
  created_at timestamptz not null default now()
);

create table if not exists public.guardian_elder_links (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  elder_id uuid references public.profiles(id) on delete cascade,
  elder_email text not null,
  parent_name text not null,
  relation text not null,
  status text not null default 'pending' check (status in ('pending', 'connected', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists guardian_elder_links_pending_unique
  on public.guardian_elder_links (guardian_id, elder_email)
  where status = 'pending';

create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  generic_name text,
  dosage text not null,
  dosage_unit text,
  schedule_time text,
  time text,
  days_of_week integer[] not null default array[0,1,2,3,4,5,6],
  instruction text,
  instructions text,
  notes text,
  prescribed_by text,
  frequency text not null default 'once',
  meal_timing text,
  start_date date,
  end_date date,
  is_recurring boolean not null default true,
  priority text not null default 'Medium',
  category text not null default 'prescription',
  stock integer,
  total_stock integer,
  is_active boolean not null default true,
  snooze_minutes integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.medicine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  taken_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists medicine_logs_one_per_day
  on public.medicine_logs (user_id, medicine_id, ((taken_at at time zone 'UTC')::date));

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  check_in_date date not null default (timezone('utc', now()))::date,
  mood text check (mood in ('happy', 'tired', 'low', 'calm') or mood is null),
  mood_score integer,
  sleep_rested boolean default false,
  breakfast_done boolean default false,
  hydration_done boolean default false,
  pain_reported boolean default false,
  water_glasses integer,
  medicines_taken boolean,
  sleep_quality integer,
  sleep_hours numeric,
  energy_level integer,
  pain_level integer,
  physical_activity text,
  voice_note_url text,
  voice_note_duration integer,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists daily_checkins_user_date_unique
  on public.daily_checkins (user_id, check_in_date);

create index if not exists daily_checkins_user_date_idx
  on public.daily_checkins (user_id, check_in_date desc);

create table if not exists public.mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mood_score integer,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists mood_entries_user_created_idx
  on public.mood_entries (user_id, created_at desc);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  doctor_name text,
  specialty text,
  date text,
  time text,
  fee text,
  reason text,
  status text not null default 'upcoming',
  created_at timestamptz not null default now()
);

create table if not exists public.health_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  value numeric,
  unit text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null,
  content text not null,
  provider text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.guardian_elder_links enable row level security;
alter table public.medicines enable row level security;
alter table public.medicine_logs enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.mood_entries enable row level security;
alter table public.appointments enable row level security;
alter table public.health_readings enable row level security;
alter table public.ai_conversations enable row level security;

-- Basic owner policies for direct app reads/writes. Server service-role bypasses RLS.
create policy "profiles connected read" on public.profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1 from public.guardian_elder_links g
      where g.status = 'connected'
        and (
          (g.guardian_id = auth.uid() and g.elder_id = profiles.id)
          or (g.elder_id = auth.uid() and g.guardian_id = profiles.id)
        )
    )
  );

create policy "medicines guardian read connected elder" on public.medicines
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_elder_links g
      where g.guardian_id = auth.uid()
        and g.elder_id = medicines.user_id
        and g.status = 'connected'
    )
  );

create policy "medicine_logs guardian read connected elder" on public.medicine_logs
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_elder_links g
      where g.guardian_id = auth.uid()
        and g.elder_id = medicine_logs.user_id
        and g.status = 'connected'
    )
  );

create policy "daily_checkins guardian read connected elder" on public.daily_checkins
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_elder_links g
      where g.guardian_id = auth.uid()
        and g.elder_id = daily_checkins.user_id
        and g.status = 'connected'
    )
  );
create policy "profiles own update" on public.profiles for update using (auth.uid() = id);
create policy "profiles own insert" on public.profiles for insert with check (auth.uid() = id);

create policy "medicines own all" on public.medicines for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "medicine_logs own all" on public.medicine_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_checkins own all" on public.daily_checkins for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mood_entries own all" on public.mood_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "appointments own all" on public.appointments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "health_readings own all" on public.health_readings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_conversations own all" on public.ai_conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "guardian links participant read" on public.guardian_elder_links
  for select using (
    auth.uid() = guardian_id
    or auth.uid() = elder_id
    or elder_email = (select email from public.profiles where id = auth.uid())
  );

create policy "guardian links guardian insert" on public.guardian_elder_links
  for insert with check (auth.uid() = guardian_id);

create policy "guardian links elder update" on public.guardian_elder_links
  for update using (
    auth.uid() = elder_id
    or auth.uid() = guardian_id
    or elder_email = (select email from public.profiles where id = auth.uid())
  );

-- Mood Lift media catalog (see migrations/002_mood_media_tracks.sql)
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

alter table public.mood_media_tracks enable row level security;
alter table public.mood_media_favorites enable row level security;

create policy "mood_media_tracks_select_active" on public.mood_media_tracks
  for select using (is_active = true);

create policy "mood_media_favorites_select_own" on public.mood_media_favorites
  for select using (auth.uid() = user_id);

create policy "mood_media_favorites_insert_own" on public.mood_media_favorites
  for insert with check (auth.uid() = user_id);

create policy "mood_media_favorites_delete_own" on public.mood_media_favorites
  for delete using (auth.uid() = user_id);

-- health_records (Health Vault)
create table if not exists public.health_records (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  title       text        not null,
  date        text        not null,
  timestamp   bigint      not null default (extract(epoch from now()) * 1000)::bigint,
  size        text        not null default '0 MB',
  type        text        not null default 'Report',
  category    text        not null default 'Reports'
                check (category in ('Reports', 'Prescriptions', 'Prescription', 'X-Rays', 'Blood Tests', 'Blood Test')),
  icon_name   text        not null default 'document-text-outline',
  badge_bg    text        not null default '#FDEAF0',
  badge_color text        not null default '#E05A7A',
  uri         text,
  mime_type   text,
  ai_read     boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists health_records_user_ts_idx
  on public.health_records (user_id, timestamp desc);

alter table public.health_records enable row level security;

create policy "health_records_select_own" on public.health_records
  for select using (auth.uid() = user_id);
create policy "health_records_insert_own" on public.health_records
  for insert with check (auth.uid() = user_id);
create policy "health_records_update_own" on public.health_records
  for update using (auth.uid() = user_id);
create policy "health_records_delete_own" on public.health_records
  for delete using (auth.uid() = user_id);

-- mind_games_scores
create table if not exists public.mind_games_scores (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  game_type  text        not null,
  score      integer     not null default 0 check (score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists mind_games_scores_user_created_idx
  on public.mind_games_scores (user_id, created_at desc);

alter table public.mind_games_scores enable row level security;

create policy "mind_games_scores_select_all" on public.mind_games_scores
  for select using (true);
create policy "mind_games_scores_insert_own" on public.mind_games_scores
  for insert with check (auth.uid() = user_id);

-- daily_quiz_questions + daily_inspirations (see migrations/008_daily_content.sql)
create table if not exists public.daily_quiz_questions (
  id            uuid        primary key default gen_random_uuid(),
  question      text        not null,
  options       jsonb       not null,
  correct_index integer     not null check (correct_index >= 0),
  active        boolean     not null default true,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  constraint daily_quiz_questions_options_array check (jsonb_typeof(options) = 'array'),
  constraint daily_quiz_questions_sort_order_unique unique (sort_order)
);

create index if not exists daily_quiz_questions_active_sort_idx
  on public.daily_quiz_questions (active, sort_order);

create table if not exists public.daily_inspirations (
  id         uuid        primary key default gen_random_uuid(),
  quote      text        not null,
  author     text        not null,
  active     boolean     not null default true,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now(),
  constraint daily_inspirations_sort_order_unique unique (sort_order)
);

create index if not exists daily_inspirations_active_sort_idx
  on public.daily_inspirations (active, sort_order);

alter table public.daily_quiz_questions enable row level security;
alter table public.daily_inspirations enable row level security;

create policy "daily_quiz_questions_select_active" on public.daily_quiz_questions
  for select using (active = true);

create policy "daily_inspirations_select_active" on public.daily_inspirations
  for select using (active = true);

-- care_events (see migrations/009_care_events.sql)
create table if not exists public.care_events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  title       text        not null,
  sub         text        not null default '',
  time        text        not null default '',
  type        text        not null default 'Doctor'
                check (type in ('Doctor', 'Family', 'Medicine', 'Wellness')),
  color       text        not null default '#DB5461',
  emoji       text        not null default '🏥',
  date        integer     not null,
  month       text        not null,
  year        integer     not null,
  timestamp   bigint      not null,
  created_at  timestamptz not null default now()
);

create index if not exists care_events_user_ts_idx
  on public.care_events (user_id, timestamp asc);

create index if not exists care_events_user_date_idx
  on public.care_events (user_id, year, month, date);

alter table public.care_events enable row level security;

create policy "care_events_select_own_or_guardian" on public.care_events
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_elder_links g
      where g.guardian_id = auth.uid()
        and g.elder_id = care_events.user_id
        and g.status = 'connected'
    )
  );

create policy "care_events_insert_own" on public.care_events
  for insert with check (auth.uid() = user_id);

create policy "care_events_delete_own" on public.care_events
  for delete using (auth.uid() = user_id);

-- doctors catalog (Book Appointment; see migrations/007_doctors.sql)
create table if not exists public.doctors (
  id          uuid         primary key default gen_random_uuid(),
  name        text         not null,
  specialty   text         not null,
  rating      numeric(2,1) not null default 4.5
                            check (rating >= 0 and rating <= 5),
  experience  text         not null,
  fee         text         not null,
  address     text,
  image_url   text,
  is_active   boolean      not null default true,
  sort_order  integer      not null default 0,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  constraint doctors_name_specialty_unique unique (name, specialty)
);

create index if not exists doctors_specialty_active_sort_idx
  on public.doctors (specialty, is_active, sort_order);

alter table public.doctors enable row level security;

create policy "doctors_select_active" on public.doctors
  for select using (is_active = true);

-- user_settings (app preferences)
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

create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "user_settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id);
create policy "user_settings_delete_own" on public.user_settings
  for delete using (auth.uid() = user_id);
