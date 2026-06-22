-- Mind Games score history + leaderboard source

create table if not exists public.mind_games_scores (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  game_type  text        not null,
  score      integer     not null default 0 check (score >= 0),
  created_at timestamptz not null default now()
);

create index if not exists mind_games_scores_user_created_idx
  on public.mind_games_scores (user_id, created_at desc);

create index if not exists mind_games_scores_score_idx
  on public.mind_games_scores (score desc);

alter table public.mind_games_scores enable row level security;

drop policy if exists "mind_games_scores_select_all" on public.mind_games_scores;
create policy "mind_games_scores_select_all"
  on public.mind_games_scores for select
  using (true);

drop policy if exists "mind_games_scores_insert_own" on public.mind_games_scores;
create policy "mind_games_scores_insert_own"
  on public.mind_games_scores for insert
  with check (auth.uid() = user_id);
