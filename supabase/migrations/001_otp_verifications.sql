-- OTP verification records for Twilio SMS auth (server-side only)
CREATE TABLE IF NOT EXISTS otp_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164  text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_created
  ON otp_verifications (phone_e164, created_at DESC);

-- Service role only — never expose to anon/authenticated clients
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;
