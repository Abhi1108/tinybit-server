const cron = require('node-cron');
const { runNotificationChecks } = require('./notification-checks');
const { checkPushReceipts } = require('../services/notifications.service');

/**
 * In-process scheduler (plan Section 6) — runs inside the same `tinybit-api` PM2 process as
 * the Express app, not a separate script/Lambda. 15 minutes is the tightest granularity any
 * check in notification-checks.js needs (medicine_missed's grace window). Safe even if PM2
 * ever runs multiple instances of this process (cluster mode / a second EC2 box) — the
 * cron_notification_log unique-key claim in claimAndNotify makes concurrent ticks unable to
 * double-send, so this doesn't need its own separate locking.
 *
 * checkPushReceipts (plan Section 10 point 4 / 13.5 — dead-token pruning) shares the same
 * 15-minute tick since that's already the natural cadence and Expo's receipts aren't available
 * sooner than that anyway; no reason for a second schedule.
 */
function startCronJobs() {
  cron.schedule('*/15 * * * *', () => {
    runNotificationChecks().catch((err) => console.error('[cron] runNotificationChecks failed:', err));
    checkPushReceipts().catch((err) => console.error('[cron] checkPushReceipts failed:', err));
  });
}

module.exports = { startCronJobs };
