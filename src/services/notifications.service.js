const { randomUUID } = require('crypto');
const { execute } = require('../config/mysql');
const guardianService = require('./guardian.service');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Inserts one row into the in-app notifications inbox. */
async function createNotification({ userId, senderId = null, type, title, body, data = null }) {
  const id = randomUUID();
  await execute(
    `INSERT INTO notifications (id, user_id, sender_id, type, title, body, data, \`read\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, userId, senderId, type, title, body, data ? JSON.stringify(data) : null],
  );
  return id;
}

/** Sends a push notification via Expo's push API. Failures are swallowed — push is best-effort. */
async function sendExpoPush(token, { title, body, data = null }) {
  if (!token) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data: data ?? undefined,
        sound: 'default',
      }),
    });
  } catch (err) {
    console.warn('[notifications] Expo push failed:', err.message);
  }
}

/**
 * Notifies every guardian connected to an elder — one in-app notification row
 * plus a best-effort push per guardian that has a push_token on file.
 */
async function notifyGuardiansOfElder(elderId, { type, title, body, data = null }) {
  const guardians = await guardianService.getConnectedGuardians(elderId);

  for (const guardian of guardians) {
    await createNotification({
      userId: guardian.id,
      senderId: elderId,
      type,
      title,
      body,
      data,
    });
    if (guardian.push_token) {
      await sendExpoPush(guardian.push_token, { title, body, data });
    }
  }

  return guardians.length;
}

module.exports = { createNotification, sendExpoPush, notifyGuardiansOfElder };
