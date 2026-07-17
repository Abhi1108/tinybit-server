-- =============================================================================
-- TinyBit / DD Medax — MySQL 8.0+ schema (single-file bootstrap)
-- =============================================================================
--
-- Source of truth merged from:
--   tinybit-server/supabase/schema.sql
--   tinybit-server/supabase/migrations/001–012
--   tinybit/supabase/migrations/055–058, 057 (wellness moods)
--
-- Supabase → MySQL mapping (for later code migration):
--   uuid              → CHAR(36)  DEFAULT (UUID())
--   timestamptz       → DATETIME(3)  (store UTC)
--   text[]            → JSON
--   jsonb             → JSON
--   gen_random_uuid() → UUID()
--   RLS policies      → enforce in tinybit-server + retire direct Supabase client
--   Storage buckets   → S3 / GCS / local FS (health-records, journal-audio)
--
-- Known column drift to fix in application code (not duplicated here):
--   health_readings: app sometimes uses vital_type/recorded_at → canonical type/created_at
--   mood_entries: journal UI inserts mood+note; guardian API reads mood_score
--   daily_checkins: sleep_quality & energy_level are TEXT (not integer)
--
-- Run:
--   mysql -u root -p < mysql/schema.sql
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS tinybit
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tinybit;

-- -----------------------------------------------------------------------------
-- Auth (replaces Supabase auth.users)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_users (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  phone_e164    VARCHAR(32)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash TEXT         NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_users_phone (phone_e164),
  UNIQUE KEY uq_app_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  revoked_at DATETIME(3)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_refresh_tokens_user (user_id),
  KEY idx_refresh_tokens_hash (token_hash),
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otp_verifications (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  phone_e164  VARCHAR(32)  NOT NULL,
  code_hash   VARCHAR(128) NOT NULL,
  expires_at  DATETIME(3)  NOT NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  verified_at DATETIME(3)  NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_otp_phone_created (phone_e164, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Core profile
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  id                   CHAR(36)      NOT NULL,
  first_name           VARCHAR(255)  NULL,
  last_name            VARCHAR(255)  NULL,
  full_name            VARCHAR(255)  NULL,
  email                VARCHAR(255)  NULL,
  mobile               VARCHAR(32)   NULL,
  role                 VARCHAR(32)   NOT NULL DEFAULT 'elder',
  date_of_birth        DATE          NULL,
  age                  INT           NULL,
  country              VARCHAR(128)  NULL,
  country_code         VARCHAR(8)    NULL,
  location             VARCHAR(255)  NULL,
  preferred_language   VARCHAR(16)   NULL,
  timezone             VARCHAR(64)   NULL,
  -- IANA name, e.g. 'Asia/Kolkata', 'America/New_York'. NULL = not yet set (pre-rollout account).
  profile_image        TEXT          NULL,
  blood_group          VARCHAR(16)   NULL,
  height               DECIMAL(10,2) NULL,
  height_unit          VARCHAR(8)    NULL,
  weight               DECIMAL(10,2) NULL,
  weight_unit          VARCHAR(8)    NULL,
  biological_sex       VARCHAR(16)   NULL,
  medical_conditions   JSON          NULL,
  emergency_phone      VARCHAR(32)   NULL,
  emergency_name       VARCHAR(255)  NULL,
  emergency_relation   VARCHAR(64)   NULL,
  family_code          VARCHAR(64)   NULL,
  push_token           TEXT          NULL,
  plan_type            VARCHAR(32)   NOT NULL DEFAULT 'free',
  -- 'inactive' until a guardian completes their first payment (see payment_orders/payments;
  -- CONTEXT.md Q6) — elders' plan_status is never checked, this default is harmless for them.
  plan_status          VARCHAR(32)   NOT NULL DEFAULT 'inactive',
  plan_started_at      DATETIME(3)   NULL,
  plan_expires_at      DATETIME(3)   NULL,
  plan_amount          DECIMAL(12,2) NULL,
  plan_currency        VARCHAR(8)    NOT NULL DEFAULT 'INR',
  plan_interval        VARCHAR(16)   NULL,
  plan_elder_count     INT           NULL,
  streak               INT           NOT NULL DEFAULT 0,
  best_streak          INT           NOT NULL DEFAULT 0,
  is_banned            TINYINT(1)    NOT NULL DEFAULT 0,
  last_active          DATETIME(3)   NULL,
  health_qr_token      VARCHAR(64)   NULL,
  health_qr_expires_at DATETIME(3)   NULL,
  allergies            JSON          NULL,
  other_condition      TEXT          NULL,
  doctor_name          VARCHAR(255)  NULL,
  doctor_contact       VARCHAR(64)   NULL,
  deleted_at           DATETIME(3)   NULL,
  deleted_by           VARCHAR(255)  NULL,
  created_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_profiles_email (email),
  UNIQUE KEY uq_profiles_family_code (family_code),
  UNIQUE KEY uq_profiles_health_qr_token (health_qr_token),
  KEY idx_profiles_role (role),
  KEY idx_profiles_mobile (mobile),
  KEY idx_profiles_is_banned (is_banned),
  KEY idx_profiles_created_at (created_at),
  KEY idx_profiles_deleted_at (deleted_at),
  CONSTRAINT chk_profiles_role
    CHECK (role IN ('elder', 'guardian', 'caregiver', 'admin')),
  CONSTRAINT fk_profiles_app_user
    FOREIGN KEY (id) REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Streak activity log — one row per user per UTC calendar day the app was
-- opened. Backs the "This Week" / "This Month" streak calendar views and the
-- lifetime "Total Days" count.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS streak_activity_log (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id       CHAR(36)     NOT NULL,
  activity_date DATE         NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_streak_activity_user_date (user_id, activity_date),
  KEY idx_streak_activity_user (user_id, activity_date DESC),
  CONSTRAINT fk_streak_activity_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Guardian linking
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS guardian_elder_links (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  guardian_id  CHAR(36)     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  elder_id     CHAR(36)     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  elder_email  VARCHAR(255) NOT NULL,
  parent_name  VARCHAR(255) NOT NULL,
  relation     VARCHAR(64)  NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- One row per (guardian, email, status) — blocks duplicate pending invites without
  -- a STORED generated column (MySQL 8 errors on FK + generated col on same table).
  UNIQUE KEY uq_guardian_elder_status (guardian_id, elder_email, status),
  KEY idx_guardian_links_guardian (guardian_id),
  KEY idx_guardian_links_elder (elder_id),
  KEY idx_guardian_links_email (elder_email),
  KEY idx_guardian_links_guardian_status (guardian_id, status),
  KEY idx_guardian_links_status_created (status, created_at),
  CONSTRAINT chk_guardian_link_status
    CHECK (status IN ('pending', 'connected', 'declined')),
  CONSTRAINT fk_guardian_links_guardian
    FOREIGN KEY (guardian_id) REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_guardian_links_elder
    FOREIGN KEY (elder_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- User preferences & location
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                CHAR(36)     NOT NULL,
  voice_navigation       TINYINT(1)   NOT NULL DEFAULT 0,
  fall_detection         TINYINT(1)   NOT NULL DEFAULT 1,
  night_mode             TINYINT(1)   NOT NULL DEFAULT 0,
  font_scale             DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  language               VARCHAR(16)  NOT NULL DEFAULT 'en',
  -- Push-notification category opt-outs (Reminders & Alerts settings screen). Each gates only
  -- the *push* for its category — the in-app notification inbox always stays complete
  -- regardless, per this project's "every notification gets an inbox row" convention. Safety-
  -- critical types (sos_alert, guardian_reminder) are intentionally NOT covered by any of
  -- these — they're always sent, see ALWAYS_ON_NOTIFICATION_TYPES in notifications.service.js.
  notify_medicine        TINYINT(1)   NOT NULL DEFAULT 1,
  notify_wellness        TINYINT(1)   NOT NULL DEFAULT 1,
  notify_journal         TINYINT(1)   NOT NULL DEFAULT 1,
  notify_health_reports  TINYINT(1)   NOT NULL DEFAULT 1,
  notify_care_calendar   TINYINT(1)   NOT NULL DEFAULT 1,
  notify_family          TINYINT(1)   NOT NULL DEFAULT 1,
  notify_location        TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT chk_user_settings_font_scale
    CHECK (font_scale >= 0.5 AND font_scale <= 2.0),
  CONSTRAINT fk_user_settings_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS elder_locations (
  elder_id    CHAR(36)     NOT NULL,
  latitude    DOUBLE       NOT NULL DEFAULT 0,
  longitude   DOUBLE       NOT NULL DEFAULT 0,
  accuracy    DOUBLE       NULL,
  address     TEXT         NULL,
  is_sharing  TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (elder_id),
  KEY idx_elder_locations_sharing (is_sharing),
  CONSTRAINT fk_elder_locations_profile
    FOREIGN KEY (elder_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- SOS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  name       VARCHAR(255) NOT NULL,
  role       VARCHAR(128) NOT NULL DEFAULT '',
  phone      VARCHAR(32)  NOT NULL,
  color      VARCHAR(16)  NOT NULL DEFAULT '#F0F4FF',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_emergency_contacts_user (user_id, created_at),
  CONSTRAINT fk_emergency_contacts_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sos_alerts (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id      CHAR(36)     NOT NULL,
  triggered_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at  DATETIME(3)  NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  KEY idx_sos_alerts_user (user_id, triggered_at DESC),
  CONSTRAINT chk_sos_alert_status
    CHECK (status IN ('active', 'resolved', 'cancelled')),
  CONSTRAINT fk_sos_alerts_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Medicines
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS medicines (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id        CHAR(36)     NOT NULL,
  name           VARCHAR(255) NOT NULL,
  generic_name   VARCHAR(255) NULL,
  dosage         VARCHAR(128) NOT NULL,
  dosage_unit    VARCHAR(32)  NULL,
  schedule_time  VARCHAR(32)  NULL,
  time           VARCHAR(16)  NULL,
  days_of_week   JSON         NOT NULL DEFAULT (JSON_ARRAY(0, 1, 2, 3, 4, 5, 6)),
  instruction    TEXT         NULL,
  instructions   TEXT         NULL,
  notes          TEXT         NULL,
  prescribed_by  VARCHAR(255) NULL,
  frequency      VARCHAR(64)  NOT NULL DEFAULT 'once',
  meal_timing    VARCHAR(16)  NULL,
  start_date     DATE         NULL,
  end_date       DATE         NULL,
  is_recurring   TINYINT(1)   NOT NULL DEFAULT 1,
  priority       VARCHAR(32)  NOT NULL DEFAULT 'Medium',
  category       VARCHAR(64)  NOT NULL DEFAULT 'prescription',
  stock          INT          NULL,
  total_stock    INT          NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  snooze_minutes INT          NOT NULL DEFAULT 10,
  doctor_phone   VARCHAR(32)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_medicines_user_active (user_id, is_active),
  KEY idx_medicines_user_created (user_id, created_at DESC),
  KEY idx_medicines_is_active (is_active),
  CONSTRAINT fk_medicines_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS medicine_logs (
  id          CHAR(36)    NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)    NOT NULL,
  medicine_id CHAR(36)    NOT NULL,
  taken_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  taken_date  DATE        GENERATED ALWAYS AS (DATE(taken_at)) STORED,
  notes       TEXT        NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_medicine_logs_one_per_day (user_id, medicine_id, taken_date),
  KEY idx_medicine_logs_user (user_id, taken_at DESC),
  KEY idx_medicine_logs_user_date (user_id, taken_date),
  CONSTRAINT fk_medicine_logs_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_medicine_logs_medicine
    FOREIGN KEY (medicine_id) REFERENCES medicines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Calorie Tracker
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calorie_goals (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id        CHAR(36)     NOT NULL,
  daily_calories INT          NOT NULL DEFAULT 2000,
  protein_g      INT          NOT NULL DEFAULT 60,
  carbs_g        INT          NOT NULL DEFAULT 250,
  fat_g          INT          NOT NULL DEFAULT 65,
  diet_type      VARCHAR(24)  NULL,
  activity_level VARCHAR(24)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_calorie_goals_user (user_id),
  CONSTRAINT fk_calorie_goals_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meal_logs (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id       CHAR(36)     NOT NULL,
  meal_type     VARCHAR(16)  NOT NULL,
  food_items    JSON         NULL,
  calories      INT          NOT NULL DEFAULT 0,
  protein_g     DECIMAL(6,1) NULL,
  carbs_g       DECIMAL(6,1) NULL,
  fat_g         DECIMAL(6,1) NULL,
  fiber_g       DECIMAL(6,1) NULL,
  sugar_g       DECIMAL(6,1) NULL,
  sodium_mg     DECIMAL(7,1) NULL,
  vitamins      JSON         NULL,
  minerals      JSON         NULL,
  health_score  INT          NULL,
  health_rating VARCHAR(16)  NULL,
  portion_size  VARCHAR(16)  NULL,
  serving_info  VARCHAR(128) NULL,
  image_url     TEXT         NULL,
  logged_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  logged_date   DATE         GENERATED ALWAYS AS (DATE(logged_at)) STORED,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_meal_logs_user_date (user_id, logged_date),
  KEY idx_meal_logs_user (user_id, logged_at DESC),
  CONSTRAINT fk_meal_logs_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT chk_meal_logs_type
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Wellness & vitals
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_checkins (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id             CHAR(36)     NOT NULL,
  check_in_date       DATE         NOT NULL,
  mood                VARCHAR(32)  NULL,
  mood_score          INT          NULL,
  sleep_rested        TINYINT(1)   NULL DEFAULT 0,
  breakfast_done      TINYINT(1)   NULL DEFAULT 0,
  hydration_done      TINYINT(1)   NULL DEFAULT 0,
  pain_reported       TINYINT(1)   NULL DEFAULT 0,
  water_glasses       INT          NULL,
  medicines_taken     TINYINT(1)   NULL,
  sleep_quality       VARCHAR(32)  NULL,
  sleep_hours         DECIMAL(4,1) NULL,
  energy_level        VARCHAR(32)  NULL,
  pain_level          INT          NULL,
  physical_activity   VARCHAR(32)  NULL,
  voice_note_url      TEXT         NULL,
  voice_note_duration INT          NULL,
  notes               TEXT         NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_checkins_user_date (user_id, check_in_date),
  KEY idx_daily_checkins_created (created_at),
  CONSTRAINT chk_daily_checkins_mood
    CHECK (mood IS NULL OR mood IN ('happy', 'tired', 'low', 'calm', 'anxious', 'stressed')),
  CONSTRAINT chk_daily_checkins_mood_score
    CHECK (mood_score IS NULL OR (mood_score >= 1 AND mood_score <= 5)),
  CONSTRAINT fk_daily_checkins_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mood_entries (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  mood       VARCHAR(32)  NULL,
  mood_score INT          NULL,
  note       TEXT         NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mood_entries_user_created (user_id, created_at DESC),
  KEY idx_mood_entries_created (created_at),
  CONSTRAINT fk_mood_entries_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS health_readings (
  id         CHAR(36)       NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)       NOT NULL,
  `type`     VARCHAR(64)    NOT NULL,
  value      DECIMAL(12,4)  NULL,
  unit       VARCHAR(32)    NULL,
  notes      TEXT           NULL,
  created_at DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_health_readings_user_created (user_id, created_at DESC),
  KEY idx_health_readings_user_type (user_id, `type`),
  CONSTRAINT fk_health_readings_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS health_records (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  title       VARCHAR(255) NOT NULL,
  date        VARCHAR(64)  NOT NULL,
  timestamp   BIGINT       NOT NULL,
  size        VARCHAR(32)  NOT NULL DEFAULT '0 MB',
  `type`      VARCHAR(64)  NOT NULL DEFAULT 'Report',
  category    VARCHAR(64)  NOT NULL DEFAULT 'Reports',
  icon_name   VARCHAR(64)  NOT NULL DEFAULT 'document-text-outline',
  badge_bg    VARCHAR(16)  NOT NULL DEFAULT '#FDEAF0',
  badge_color VARCHAR(16)  NOT NULL DEFAULT '#E05A7A',
  uri         TEXT         NULL,
  mime_type   VARCHAR(128) NULL,
  ai_read     TINYINT(1)   NOT NULL DEFAULT 0,
  ai_insights JSON         NULL,
  ai_insights_at DATETIME(3) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_health_records_user_ts (user_id, timestamp DESC),
  KEY idx_health_records_user_category (user_id, category),
  CONSTRAINT chk_health_records_category
    CHECK (category IN ('Reports', 'Prescriptions', 'Prescription', 'X-Rays', 'Blood Tests', 'Blood Test')),
  CONSTRAINT fk_health_records_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "My Doctors" — a user's own saved contacts (Health Records screen), distinct
-- from the admin-managed public `doctors` catalog used for appointment booking.
CREATE TABLE IF NOT EXISTS saved_doctors (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  name        VARCHAR(255) NOT NULL,
  phone       VARCHAR(32)  NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_saved_doctors_user (user_id, created_at),
  CONSTRAINT fk_saved_doctors_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Appointments & care calendar
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS appointments (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  doctor_name VARCHAR(255) NULL,
  specialty   VARCHAR(128) NULL,
  date        VARCHAR(64)  NULL,
  time        VARCHAR(32)  NULL,
  fee         VARCHAR(32)  NULL,
  reason      TEXT         NULL,
  status      VARCHAR(32)  NOT NULL DEFAULT 'upcoming',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_appointments_user (user_id, created_at DESC),
  CONSTRAINT fk_appointments_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS care_events (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  title      VARCHAR(255) NOT NULL,
  sub        VARCHAR(255) NOT NULL DEFAULT '',
  time       VARCHAR(32)  NOT NULL DEFAULT '',
  `type`     VARCHAR(32)  NOT NULL DEFAULT 'Doctor',
  color      VARCHAR(16)  NOT NULL DEFAULT '#DB5461',
  emoji      VARCHAR(16)  NOT NULL DEFAULT '🏥',
  date       INT          NOT NULL,
  month      VARCHAR(8)   NOT NULL,
  year       INT          NOT NULL,
  timestamp  BIGINT       NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_care_events_user_ts (user_id, timestamp),
  KEY idx_care_events_user_date (user_id, year, month, date),
  CONSTRAINT chk_care_events_type
    CHECK (`type` IN ('Doctor', 'Family', 'Therapy', 'Activity', 'Medicine', 'Wellness')),
  CONSTRAINT fk_care_events_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Journal & family messaging (app-direct; not in server schema.sql)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journal (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  `type`     VARCHAR(16)  NOT NULL,
  content    TEXT         NOT NULL,
  audio_uri  TEXT         NULL,
  prompt     TEXT         NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_journal_user_created (user_id, created_at DESC),
  CONSTRAINT chk_journal_type
    CHECK (`type` IN ('Written', 'Voice')),
  CONSTRAINT fk_journal_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS family_messages (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  sender_id   CHAR(36)     NOT NULL,
  receiver_id CHAR(36)     NOT NULL,
  message     TEXT         NOT NULL,
  audio_url   TEXT         NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_family_messages_receiver (receiver_id, created_at DESC),
  KEY idx_family_messages_sender (sender_id, created_at DESC),
  CONSTRAINT fk_family_messages_sender
    FOREIGN KEY (sender_id) REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_family_messages_receiver
    FOREIGN KEY (receiver_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- AI chat history
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_conversations (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NULL,
  role       VARCHAR(32)  NOT NULL,
  content    TEXT         NOT NULL,
  provider   VARCHAR(64)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_conversations_user (user_id, created_at DESC),
  KEY idx_ai_conversations_created (created_at),
  CONSTRAINT fk_ai_conversations_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Mood Lift media catalog
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mood_media_tracks (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  category         VARCHAR(32)  NOT NULL,
  media_type       ENUM('audio', 'video', 'youtube') NOT NULL DEFAULT 'audio',
  title            VARCHAR(255) NOT NULL,
  subtitle         VARCHAR(255) NULL,
  duration_seconds INT          NULL,
  duration_label   VARCHAR(32)  NULL,
  icon_name        VARCHAR(64)  NULL,
  icon_url         TEXT         NULL,
  audio_url        TEXT         NULL,
  media_url        TEXT         NULL,
  sort_order       INT          NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mood_media_category_title (category, title),
  KEY idx_mood_media_category_active (category, is_active, sort_order),
  CONSTRAINT chk_mood_media_category
    CHECK (category IN ('bhajans', 'meditation', 'jokes_fun', 'nature_sounds')),
  CONSTRAINT chk_mood_media_duration
    CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  CONSTRAINT chk_mood_media_url_by_type
    CHECK (
      (media_type = 'audio' AND audio_url IS NOT NULL) OR
      (media_type IN ('video', 'youtube') AND media_url IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mood_media_favorites (
  user_id    CHAR(36)    NOT NULL,
  track_id   CHAR(36)    NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, track_id),
  KEY idx_mood_media_favorites_user (user_id),
  CONSTRAINT fk_mood_media_favorites_user
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_mood_media_favorites_track
    FOREIGN KEY (track_id) REFERENCES mood_media_tracks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Mind games & daily content
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mind_games_scores (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id          CHAR(36)     NOT NULL,
  game_type        VARCHAR(64)  NOT NULL,
  score            INT          NOT NULL DEFAULT 0,
  duration_seconds INT          NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mind_games_user_created (user_id, created_at DESC),
  KEY idx_mind_games_score (score DESC),
  CONSTRAINT chk_mind_games_score
    CHECK (score >= 0),
  CONSTRAINT chk_mind_games_duration
    CHECK (duration_seconds >= 0),
  CONSTRAINT fk_mind_games_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_quiz_questions (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  question      TEXT         NOT NULL,
  options       JSON         NOT NULL,
  correct_index INT          NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_quiz_sort_order (sort_order),
  KEY idx_daily_quiz_active_sort (active, sort_order),
  CONSTRAINT chk_daily_quiz_correct_index
    CHECK (correct_index >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_inspirations (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  quote      TEXT         NOT NULL,
  author     VARCHAR(255) NOT NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_inspirations_sort_order (sort_order),
  KEY idx_daily_inspirations_active_sort (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- In-app notifications (admin broadcast + future push inbox)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  sender_id  CHAR(36)     NULL,
  type       VARCHAR(64)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       TEXT         NOT NULL,
  data       JSON         NULL,
  `read`     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_user_created (user_id, created_at DESC),
  KEY idx_notifications_user_unread (user_id, `read`, created_at DESC),
  KEY idx_notifications_type (type),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Push tokens — one row per device/install. Replaces profiles.push_token
-- (single column, one token per user — overwritten on every new device login,
-- so a guardian with two devices silently loses push on one of them). token is
-- globally unique, not (user_id, token): an Expo push token is scoped to the
-- physical device + app install, not to whichever account is logged in, so a
-- save is always an upsert — the token belongs to whoever registered it most
-- recently, no orphaned dual-ownership possible. profiles.push_token is left
-- in place for now (unused going forward) pending a confirmed follow-up to
-- drop it — see docs/push-notifications-progress.md.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS push_tokens (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id      CHAR(36)     NOT NULL,
  token        VARCHAR(255) NOT NULL,
  platform     ENUM('ios','android','web') NOT NULL,
  device_id    VARCHAR(255) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_tokens_token (token),
  KEY idx_push_tokens_user (user_id),
  CONSTRAINT fk_push_tokens_user
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Cron notification claim log (plan Section 15.1) — atomic claim-then-send so a
-- 15-minute cron tick can never double-send the same (user, type, entity, date)
-- combination, even if a tick overlaps a slow previous run or the host scales beyond
-- one process. Mirrors streak_activity_log's INSERT IGNORE + unique-key idiom exactly
-- (same pattern already proven in production, not a new one). entity_id disambiguates
-- checks that can fire more than once per day per user (medicine_missed keys on
-- medicine_id, care_event_reminder on the event id); every other check uses ''.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cron_notification_log (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  type       VARCHAR(64)  NOT NULL,
  entity_id  VARCHAR(64)  NOT NULL DEFAULT '',
  sent_date  DATE         NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cron_notif (user_id, type, entity_id, sent_date),
  CONSTRAINT fk_cron_notif_user
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Action-triggered notification debounce log (plan Section 17.3) — a sibling to
-- cron_notification_log, but a rolling time window instead of a permanent once-per-day
-- claim: a genuine repeat action (editing the same medicine again next week) must still
-- notify, only a near-instant duplicate (a double-tap, a network retry) should be
-- suppressed. See shouldSendActionNotification in notifications.service.js for the
-- atomic INSERT ... ON DUPLICATE KEY UPDATE idiom that makes the race-safety work without
-- a permanent unique-claim row blocking future legitimate sends.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS action_notification_log (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  type       VARCHAR(64)  NOT NULL,
  entity_id  VARCHAR(64)  NOT NULL DEFAULT '',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_action_notif (user_id, type, entity_id),
  CONSTRAINT fk_action_notif_user
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Push receipt tickets (plan Section 10 point 4 / 13.5) — every successful Expo push send
-- returns a ticket with a receipt id; the actual delivery outcome (including
-- `DeviceNotRegistered`, meaning the token is dead — app uninstalled, OS revoked it) is only
-- available a while later via a separate receipts lookup. No FK to push_tokens: a token can be
-- reassigned to a different user (Phase 2's design) or already deleted by the time its receipt
-- is checked, and pruning matches on the raw token string regardless of current ownership.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS push_receipt_tickets (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  ticket_id  VARCHAR(64)  NOT NULL,
  token      VARCHAR(255) NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_receipt_ticket (ticket_id),
  KEY idx_push_receipt_tickets_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Admin audit log
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  actor       VARCHAR(255) NOT NULL,
  action      VARCHAR(64)  NOT NULL,
  target_type VARCHAR(32)  NOT NULL,
  target_id   CHAR(36)     NULL,
  details     JSON         NULL,
  ip          VARCHAR(45)  NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_audit_log_target (target_type, target_id),
  KEY idx_admin_audit_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Doctor booking catalog
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS doctors (
  id          CHAR(36)      NOT NULL DEFAULT (UUID()),
  name        VARCHAR(255)  NOT NULL,
  specialty   VARCHAR(128)  NOT NULL,
  rating      DECIMAL(2,1)  NOT NULL DEFAULT 4.5,
  experience  VARCHAR(64)   NOT NULL,
  hospital    VARCHAR(255)  NULL,
  phone       VARCHAR(32)   NULL,
  email       VARCHAR(255)  NULL,
  about       TEXT          NULL,
  fee         VARCHAR(32)   NOT NULL,
  address     TEXT          NULL,
  image_url   TEXT          NULL,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_doctors_name_specialty (name, specialty),
  KEY idx_doctors_specialty_active (specialty, is_active, sort_order),
  CONSTRAINT chk_doctors_rating
    CHECK (rating >= 0 AND rating <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Help & Guide catalog (admin-managed, no seed data)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS help_tutorials (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  category         VARCHAR(32)  NOT NULL,
  title            VARCHAR(255) NOT NULL,
  description      TEXT         NULL,
  video_url        TEXT         NULL,
  thumbnail_url    TEXT         NULL,
  difficulty       VARCHAR(16)  NOT NULL DEFAULT 'beginner',
  duration_seconds INT          NULL,
  sort_order       INT          NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_help_tutorials_category (category, is_active, sort_order),
  CONSTRAINT chk_help_tutorials_category
    CHECK (category IN ('getting_started', 'health_tracking', 'medicine_management', 'talking_with_sathi', 'emergency_features', 'family_features')),
  CONSTRAINT chk_help_tutorials_difficulty
    CHECK (difficulty IN ('beginner', 'intermediate', 'advanced'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS help_faqs (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  question    VARCHAR(500) NOT NULL,
  answer      TEXT         NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_help_faqs_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Guardian payments (Razorpay) — see tinybit-server/CONTEXT.md and docs/adr/000{1,2,3}
-- for the design rationale (manual renewal, country x elder_count pricing tiers,
-- flat-delta mid-cycle upgrades).
-- -----------------------------------------------------------------------------

-- Admin-editable (country_code, elder_count) -> price rules. country_code = '*' is
-- the fallback for any country without an explicit row. elder_count beyond the
-- highest configured row for a country reuses that row's price (tier caps out).
CREATE TABLE IF NOT EXISTS payment_pricing_tiers (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  country_code    VARCHAR(4)    NOT NULL DEFAULT '*',
  elder_count     INT           NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  currency        VARCHAR(8)    NOT NULL,
  interval_days   INT           NOT NULL DEFAULT 365,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pricing_country_eldercount (country_code, elder_count),
  CONSTRAINT chk_pricing_elder_count CHECK (elder_count >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per Razorpay Order we create. Snapshots the tier at purchase time so
-- history/refunds never depend on payment_pricing_tiers still having the same values.
CREATE TABLE IF NOT EXISTS payment_orders (
  id                       CHAR(36)      NOT NULL DEFAULT (UUID()),
  guardian_id              CHAR(36)      NOT NULL,
  razorpay_order_id        VARCHAR(64)   NOT NULL,
  kind                     VARCHAR(16)   NOT NULL DEFAULT 'renewal',
  pricing_tier_id          CHAR(36)      NULL,
  elder_count_at_purchase  INT           NOT NULL,
  amount                   DECIMAL(12,2) NOT NULL,          -- amount actually charged via Razorpay (full tier price for 'renewal'; delta for 'upgrade', ADR 0003)
  tier_amount              DECIMAL(12,2) NOT NULL,          -- full price of the destination tier — applied to profiles.plan_amount regardless of kind
  interval_days            INT           NOT NULL,          -- snapshotted from the tier — applied to profiles.plan_expires_at on 'renewal' (unchanged on 'upgrade', ADR 0003)
  currency                 VARCHAR(8)    NOT NULL,
  previous_tier_amount     DECIMAL(12,2) NULL,
  previous_elder_count     INT           NULL,
  receipt                  VARCHAR(64)   NOT NULL,
  status                   VARCHAR(16)   NOT NULL DEFAULT 'created',
  notes                    JSON          NULL,
  created_at               DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_orders_razorpay_id (razorpay_order_id),
  KEY idx_payment_orders_guardian (guardian_id),
  CONSTRAINT chk_payment_orders_kind CHECK (kind IN ('renewal', 'upgrade')),
  CONSTRAINT chk_payment_orders_status CHECK (status IN ('created', 'paid', 'expired', 'cancelled')),
  CONSTRAINT fk_payment_orders_guardian
    FOREIGN KEY (guardian_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per Razorpay Payment entity. An Order can have multiple payment
-- attempts (retries after a failure); only one is ever captured.
CREATE TABLE IF NOT EXISTS payments (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  order_id             CHAR(36)      NOT NULL,
  razorpay_payment_id  VARCHAR(64)   NOT NULL,
  razorpay_signature   VARCHAR(255)  NULL,
  method               VARCHAR(32)   NULL,
  status               VARCHAR(16)   NOT NULL DEFAULT 'created',
  amount               DECIMAL(12,2) NOT NULL,
  currency             VARCHAR(8)    NOT NULL,
  failure_code         VARCHAR(64)   NULL,
  failure_reason       TEXT          NULL,
  captured_at          DATETIME(3)   NULL,
  raw_response         JSON          NULL,
  created_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_razorpay_id (razorpay_payment_id),
  KEY idx_payments_order (order_id),
  CONSTRAINT chk_payments_status CHECK (status IN ('created', 'authorized', 'captured', 'failed', 'refunded')),
  CONSTRAINT fk_payments_order
    FOREIGN KEY (order_id) REFERENCES payment_orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin-initiated refunds only (no guardian-facing self-serve refund in this pass).
CREATE TABLE IF NOT EXISTS payment_refunds (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  payment_id          CHAR(36)      NOT NULL,
  razorpay_refund_id  VARCHAR(64)   NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  currency            VARCHAR(8)    NOT NULL,
  speed               VARCHAR(16)   NOT NULL DEFAULT 'normal',
  status              VARCHAR(16)   NOT NULL DEFAULT 'pending',
  reason              TEXT          NULL,
  initiated_by_admin  VARCHAR(255)  NULL,
  raw_response        JSON          NULL,
  created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_razorpay_id (razorpay_refund_id),
  KEY idx_refunds_payment (payment_id),
  CONSTRAINT chk_refunds_status CHECK (status IN ('pending', 'processed', 'failed')),
  CONSTRAINT fk_refunds_payment
    FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotency ledger — Razorpay may redeliver the same webhook event.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  razorpay_event_id  VARCHAR(64)  NOT NULL,
  event_type         VARCHAR(64)  NOT NULL,
  payload            JSON         NOT NULL,
  processed_at       DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_events_event_id (razorpay_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- End of schema — 39 tables
-- =============================================================================
-- app_users, refresh_tokens, otp_verifications
-- profiles, streak_activity_log, guardian_elder_links, user_settings, elder_locations
-- emergency_contacts, sos_alerts
-- medicines, medicine_logs
-- daily_checkins, mood_entries, health_readings, health_records
-- appointments, care_events
-- journal, family_messages
-- ai_conversations
-- mood_media_tracks, mood_media_favorites
-- mind_games_scores, daily_quiz_questions, daily_inspirations
-- notifications
-- doctors, help_tutorials, help_faqs
-- payment_pricing_tiers, payment_orders, payments, payment_refunds, payment_webhook_events
-- =============================================================================
