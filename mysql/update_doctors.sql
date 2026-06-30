-- Update doctors table schema to support hospital/clinic and contact details
-- Safe ALTER script for MySQL 8.0.19+ (or run individually)

ALTER TABLE doctors ADD COLUMN IF NOT EXISTS hospital VARCHAR(255) NULL AFTER experience;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NULL AFTER hospital;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL AFTER phone;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS about TEXT NULL AFTER email;
