-- Emergency Health Card QR token on profiles (public scan link).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS health_qr_token text,
  ADD COLUMN IF NOT EXISTS health_qr_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS allergies text[],
  ADD COLUMN IF NOT EXISTS other_condition text,
  ADD COLUMN IF NOT EXISTS doctor_name text,
  ADD COLUMN IF NOT EXISTS doctor_contact text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_health_qr_token_key
  ON public.profiles (health_qr_token)
  WHERE health_qr_token IS NOT NULL;
