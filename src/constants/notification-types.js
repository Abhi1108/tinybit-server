/**
 * Canonical vocabulary for the `type` field used by the in-app/push notification system
 * (services/notifications.service.js). Add new event types here, not as inline string
 * literals at call sites, so every controller stays in sync as new events are added.
 */
const NOTIFICATION_TYPES = Object.freeze({
  // Guardian <-> elder connection
  GUARDIAN_INVITE: 'guardian_invite',
  GUARDIAN_INVITE_ACCEPTED: 'guardian_invite_accepted',
  GUARDIAN_ALERT_NOTIFY: 'guardian_alert_notify',
  GUARDIAN_REMINDER: 'guardian_reminder',

  // Medicines
  MEDICINE_ADDED: 'medicine_added',
  MEDICINE_UPDATED: 'medicine_updated',
  MEDICINE_REMOVED: 'medicine_removed',
  MEDICINE_DOSE_COMPLETED: 'medicine_dose_completed',

  // Health vault / journal / wellness
  REPORT_UPLOADED: 'report_uploaded',
  JOURNAL_ADDED: 'journal_added',
  DAILY_CHECKIN: 'daily_checkin',
  MOOD_LIFT_COMPLETED: 'mood_lift_completed',

  // Safety
  SOS_ALERT: 'sos_alert',
  EMERGENCY_CONTACT_UPDATED: 'emergency_contact_updated',

  // Location
  LOCATION_UPDATE: 'location_update',
  LOCATION_SHARING_ENABLED: 'location_sharing_enabled',
});

module.exports = { NOTIFICATION_TYPES };
