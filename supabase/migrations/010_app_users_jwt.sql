-- Custom JWT auth: app_users + refresh_tokens (replaces Supabase Auth for sessions)

create table if not exists public.app_users (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text unique not null,
  email         text unique not null,
  password_hash text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists refresh_tokens_token_hash_idx on public.refresh_tokens(token_hash);

-- Backfill app_users for legacy profiles (auth.users era) before repointing FK
insert into public.app_users (id, phone_e164, email, created_at, updated_at)
select
  p.id,
  case
    when nullif(trim(p.mobile), '') is not null
      and not exists (
        select 1 from public.app_users u
        where u.phone_e164 = trim(p.mobile)
      )
      then trim(p.mobile)
    when p.email ~ '^\d+@phone\.tinybit\.app$'
      and not exists (
        select 1 from public.app_users u
        where u.phone_e164 = '+' || split_part(p.email, '@', 1)
      )
      then '+' || split_part(p.email, '@', 1)
    else '+99' || right(replace(p.id::text, '-', ''), 13)
  end as phone_e164,
  coalesce(
    nullif(lower(trim(p.email)), ''),
    p.id::text || '@legacy.tinybit.app'
  ) as email,
  coalesce(p.created_at, now()) as created_at,
  now() as updated_at
from public.profiles p
where not exists (
  select 1 from public.app_users u where u.id = p.id
)
on conflict (id) do nothing;

-- Repoint profiles.id FK from auth.users → app_users (when safe)
do $$
declare
  r record;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles'
  ) then
    for r in
      select tc.constraint_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
        and ccu.table_schema = tc.table_schema
      where tc.table_schema = 'public'
        and tc.table_name = 'profiles'
        and tc.constraint_type = 'FOREIGN KEY'
        and kcu.column_name = 'id'
    loop
      execute format('alter table public.profiles drop constraint %I', r.constraint_name);
    end loop;

    if not exists (
      select 1
      from information_schema.table_constraints
      where table_schema = 'public'
        and table_name = 'profiles'
        and constraint_name = 'profiles_id_fkey'
    ) then
      alter table public.profiles
        add constraint profiles_id_fkey
        foreign key (id) references public.app_users(id) on delete cascade;
    end if;
  end if;
end $$;
