-- Health Vault document records
-- Ported from tinybit-test-ref 019_health_records.sql

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

alter table public.medicines
  add column if not exists doctor_phone text;

create index if not exists health_records_user_ts_idx
  on public.health_records (user_id, timestamp desc);

create index if not exists health_records_user_category_idx
  on public.health_records (user_id, category);

alter table public.health_records enable row level security;

drop policy if exists "health_records_select_own" on public.health_records;
create policy "health_records_select_own"
  on public.health_records for select
  using (auth.uid() = user_id);

drop policy if exists "health_records_insert_own" on public.health_records;
create policy "health_records_insert_own"
  on public.health_records for insert
  with check (auth.uid() = user_id);

drop policy if exists "health_records_update_own" on public.health_records;
create policy "health_records_update_own"
  on public.health_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "health_records_delete_own" on public.health_records;
create policy "health_records_delete_own"
  on public.health_records for delete
  using (auth.uid() = user_id);
