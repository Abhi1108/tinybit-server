-- Update care_events check constraint to support Doctor, Family, Therapy, Activity, Medicine, and Wellness
ALTER TABLE care_events DROP CONSTRAINT chk_care_events_type;
ALTER TABLE care_events ADD CONSTRAINT chk_care_events_type CHECK (`type` IN ('Doctor', 'Family', 'Therapy', 'Activity', 'Medicine', 'Wellness'));
