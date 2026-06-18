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
  health_qr_token text unique,
  health_qr_expires_at timestamptz,
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
  mood_score integer,
  water_glasses integer,
  medicines_taken boolean,
  sleep_quality integer,
  sleep_hours numeric,
  energy_level integer,
  pain_level integer,
  physical_activity text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists daily_checkins_user_created_idx
  on public.daily_checkins (user_id, created_at desc);

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
create policy "profiles own read" on public.profiles for select using (auth.uid() = id);
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
  for select using (auth.uid() = guardian_id or auth.uid() = elder_id);

create policy "guardian links guardian insert" on public.guardian_elder_links
  for insert with check (auth.uid() = guardian_id);

create policy "guardian links elder update" on public.guardian_elder_links
  for update using (auth.uid() = elder_id or auth.uid() = guardian_id);
