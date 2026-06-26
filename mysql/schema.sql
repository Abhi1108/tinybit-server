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
  plan_status          VARCHAR(32)   NOT NULL DEFAULT 'active',
  plan_started_at      DATETIME(3)   NULL,
  plan_expires_at      DATETIME(3)   NULL,
  plan_amount          DECIMAL(12,2) NULL,
  plan_currency        VARCHAR(8)    NOT NULL DEFAULT 'INR',
  plan_interval        VARCHAR(16)   NULL,
  streak               INT           NOT NULL DEFAULT 0,
  is_banned            TINYINT(1)    NOT NULL DEFAULT 0,
  last_active          DATETIME(3)   NULL,
  health_qr_token      VARCHAR(64)   NULL,
  health_qr_expires_at DATETIME(3)   NULL,
  allergies            JSON          NULL,
  other_condition      TEXT          NULL,
  doctor_name          VARCHAR(255)  NULL,
  doctor_contact       VARCHAR(64)   NULL,
  created_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_profiles_email (email),
  UNIQUE KEY uq_profiles_family_code (family_code),
  UNIQUE KEY uq_profiles_health_qr_token (health_qr_token),
  CONSTRAINT chk_profiles_role
    CHECK (role IN ('elder', 'guardian', 'caregiver', 'admin')),
  CONSTRAINT fk_profiles_app_user
    FOREIGN KEY (id) REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Guardian linking
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS guardian_elder_links (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  guardian_id  CHAR(36)     NOT NULL,
  elder_id     CHAR(36)     NULL,
  elder_email  VARCHAR(255) NOT NULL,
  parent_name  VARCHAR(255) NOT NULL,
  relation     VARCHAR(64)  NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  pending_key  VARCHAR(300) GENERATED ALWAYS AS (
    IF(status = 'pending', CONCAT(guardian_id, ':', elder_email), NULL)
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guardian_elder_pending (pending_key),
  KEY idx_guardian_links_guardian (guardian_id),
  KEY idx_guardian_links_elder (elder_id),
  KEY idx_guardian_links_email (elder_email),
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
  user_id            CHAR(36)     NOT NULL,
  voice_navigation   TINYINT(1)   NOT NULL DEFAULT 0,
  vibration_alerts   TINYINT(1)   NOT NULL DEFAULT 1,
  fall_detection     TINYINT(1)   NOT NULL DEFAULT 1,
  night_mode         TINYINT(1)   NOT NULL DEFAULT 0,
  font_scale         DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  language           VARCHAR(16)  NOT NULL DEFAULT 'en',
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
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
  CONSTRAINT fk_medicine_logs_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_medicine_logs_medicine
    FOREIGN KEY (medicine_id) REFERENCES medicines (id) ON DELETE CASCADE
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
  KEY idx_daily_checkins_user_date (user_id, check_in_date DESC),
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
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_health_records_user_ts (user_id, timestamp DESC),
  KEY idx_health_records_user_category (user_id, category),
  CONSTRAINT chk_health_records_category
    CHECK (category IN ('Reports', 'Prescriptions', 'Prescription', 'X-Rays', 'Blood Tests', 'Blood Test')),
  CONSTRAINT fk_health_records_profile
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
    CHECK (`type` IN ('Doctor', 'Family', 'Medicine', 'Wellness')),
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
  CONSTRAINT fk_ai_conversations_profile
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Mood Lift media catalog
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mood_media_tracks (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  category         VARCHAR(32)  NOT NULL,
  title            VARCHAR(255) NOT NULL,
  subtitle         VARCHAR(255) NULL,
  duration_seconds INT          NULL,
  duration_label   VARCHAR(32)  NULL,
  icon_name        VARCHAR(64)  NULL,
  icon_url         TEXT         NULL,
  audio_url        TEXT         NOT NULL,
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
    CHECK (duration_seconds IS NULL OR duration_seconds > 0)
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
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  game_type  VARCHAR(64)  NOT NULL,
  score      INT          NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mind_games_user_created (user_id, created_at DESC),
  KEY idx_mind_games_score (score DESC),
  CONSTRAINT chk_mind_games_score
    CHECK (score >= 0),
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
-- Doctor booking catalog
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS doctors (
  id          CHAR(36)      NOT NULL DEFAULT (UUID()),
  name        VARCHAR(255)  NOT NULL,
  specialty   VARCHAR(128)  NOT NULL,
  rating      DECIMAL(2,1)  NOT NULL DEFAULT 4.5,
  experience  VARCHAR(64)   NOT NULL,
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

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- End of schema — 26 tables
-- =============================================================================
-- app_users, refresh_tokens, otp_verifications
-- profiles, guardian_elder_links, user_settings, elder_locations
-- emergency_contacts, sos_alerts
-- medicines, medicine_logs
-- daily_checkins, mood_entries, health_readings, health_records
-- appointments, care_events
-- journal, family_messages
-- ai_conversations
-- mood_media_tracks, mood_media_favorites
-- mind_games_scores, daily_quiz_questions, daily_inspirations
-- doctors
-- =============================================================================
