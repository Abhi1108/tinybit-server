-- Daily quiz questions + inspiration quotes (Mind Games / Mood Lift)

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

drop policy if exists "daily_quiz_questions_select_active" on public.daily_quiz_questions;
create policy "daily_quiz_questions_select_active"
  on public.daily_quiz_questions
  for select
  using (active = true);

drop policy if exists "daily_inspirations_select_active" on public.daily_inspirations;
create policy "daily_inspirations_select_active"
  on public.daily_inspirations
  for select
  using (active = true);

-- Seed quiz questions (matches src/components/mind-games/mind-games.constants.ts)
insert into public.daily_quiz_questions (question, options, correct_index, sort_order)
values
  (
    'Who was called "Iron Man of India"?',
    '["Jawaharlal Nehru", "Mahatma Gandhi", "Subhas Bose", "Sardar Patel"]'::jsonb,
    3,
    1
  ),
  (
    'What is the national animal of India?',
    '["Lion", "Elephant", "Tiger", "Leopard"]'::jsonb,
    2,
    2
  ),
  (
    'Who wrote the Indian national anthem?',
    '["Bankim Chandra", "Rabindranath Tagore", "Subramania", "Sarojini"]'::jsonb,
    1,
    3
  ),
  (
    'Which planet is closest to the Sun?',
    '["Venus", "Earth", "Mercury", "Mars"]'::jsonb,
    2,
    4
  ),
  (
    'How many states are in India?',
    '["28", "29", "30", "31"]'::jsonb,
    0,
    5
  ),
  (
    'What is the capital of India?',
    '["Mumbai", "Kolkata", "Chennai", "New Delhi"]'::jsonb,
    3,
    6
  ),
  (
    'Who invented the telephone?',
    '["Edison", "Bell", "Tesla", "Marconi"]'::jsonb,
    1,
    7
  )
on conflict on constraint daily_quiz_questions_sort_order_unique do nothing;

-- Seed inspirations (matches src/utils/daily.ts)
insert into public.daily_inspirations (quote, author, sort_order)
values
  ('Happiness is not something ready-made. It comes from your own action.', 'Dalai Lama', 1),
  ('The purpose of our lives is to be happy.', 'Dalai Lama', 2),
  ('Life is what happens when you''re busy making other plans.', 'John Lennon', 3),
  ('You are never too old to set another goal or to dream a new dream.', 'C.S. Lewis', 4),
  ('Keep your face always toward the sunshine and shadows will fall behind you.', 'Walt Whitman', 5),
  ('Spread love everywhere you go. Let no one ever come to you without leaving happier.', 'Mother Teresa', 6),
  ('When you reach the end of your rope, tie a knot in it and hang on.', 'Franklin D. Roosevelt', 7),
  ('Your time is limited, so don''t waste it living someone else''s life.', 'Steve Jobs', 8),
  ('If you want to live a happy life, tie it to a goal, not to people or things.', 'Albert Einstein', 9),
  ('Never let the fear of striking out keep you from playing the game.', 'Babe Ruth', 10)
on conflict on constraint daily_inspirations_sort_order_unique do nothing;
