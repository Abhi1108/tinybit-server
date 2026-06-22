-- Live GPS sharing: elder writes, guardian reads (app location.tsx + home)

create table if not exists public.elder_locations (
  elder_id    uuid primary key references public.profiles(id) on delete cascade,
  latitude    double precision not null default 0,
  longitude   double precision not null default 0,
  accuracy    double precision,
  address     text,
  is_sharing  boolean not null default false,
  updated_at  timestamptz not null default now()
);

create index if not exists elder_locations_sharing_idx
  on public.elder_locations (is_sharing)
  where is_sharing = true;

alter table public.elder_locations enable row level security;

drop policy if exists "elder_locations own all" on public.elder_locations;
create policy "elder_locations own all" on public.elder_locations
  for all using (auth.uid() = elder_id) with check (auth.uid() = elder_id);

drop policy if exists "elder_locations guardian read" on public.elder_locations;
create policy "elder_locations guardian read" on public.elder_locations
  for select using (
    exists (
      select 1 from public.guardian_elder_links g
      where g.guardian_id = auth.uid()
        and g.elder_id = elder_locations.elder_id
        and g.status = 'connected'
    )
  );
