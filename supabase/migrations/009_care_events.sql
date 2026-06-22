-- Care Calendar events (ported from tinybit-test-ref 020_care_events.sql)

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

drop policy if exists "care_events_select_own" on public.care_events;
drop policy if exists "care_events_guardian_read_connected_elder" on public.care_events;
create policy "care_events_select_own_or_guardian"
  on public.care_events
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_elder_links g
      where g.guardian_id = auth.uid()
        and g.elder_id = care_events.user_id
        and g.status = 'connected'
    )
  );

drop policy if exists "care_events_insert_own" on public.care_events;
create policy "care_events_insert_own"
  on public.care_events
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "care_events_delete_own" on public.care_events;
create policy "care_events_delete_own"
  on public.care_events
  for delete
  using (auth.uid() = user_id);
