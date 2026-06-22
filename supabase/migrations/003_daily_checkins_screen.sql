-- Daily Check-In screen: mood, quick-health checklist, voice note, one row per user per day.

ALTER TABLE public.daily_checkins
  ADD COLUMN IF NOT EXISTS check_in_date date,
  ADD COLUMN IF NOT EXISTS mood text,
  ADD COLUMN IF NOT EXISTS sleep_rested boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS breakfast_done boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hydration_done boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pain_reported boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_note_url text,
  ADD COLUMN IF NOT EXISTS voice_note_duration integer;

UPDATE public.daily_checkins
SET check_in_date = (created_at AT TIME ZONE 'UTC')::date
WHERE check_in_date IS NULL;

ALTER TABLE public.daily_checkins
  ALTER COLUMN check_in_date SET DEFAULT (timezone('utc', now()))::date;

ALTER TABLE public.daily_checkins
  ALTER COLUMN check_in_date SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.daily_checkins
    ADD CONSTRAINT daily_checkins_mood_check
    CHECK (mood IN ('happy', 'tired', 'low', 'calm') OR mood IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS daily_checkins_user_date_unique
  ON public.daily_checkins (user_id, check_in_date);

CREATE INDEX IF NOT EXISTS daily_checkins_user_date_idx
  ON public.daily_checkins (user_id, check_in_date DESC);

-- Reuse journal-audio bucket for check-in voice notes (path prefix distinguishes use).
