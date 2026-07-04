const { query } = require('../config/mysql');
const { isStorageConfigured } = require('../config/storage');
const storageService = require('./storage.service');
const adminService = require('./admin.service');
const { findAppUserById, deleteAppUser } = require('./auth-users.service');
const auditService = require('./admin-audit.mysql');

// Every user-owned S3-URL column that must be swept before a user is permanently purged.
const USER_OWNED_URL_SOURCES = [
  { table: 'profiles', column: 'profile_image', where: 'id = ?' },
  { table: 'health_records', column: 'uri', where: 'user_id = ?' },
  { table: 'journal', column: 'audio_uri', where: 'user_id = ?' },
  { table: 'meal_logs', column: 'image_url', where: 'user_id = ?' },
  { table: 'daily_checkins', column: 'voice_note_url', where: 'user_id = ?' },
];

async function sweepUserStorage(userId) {
  let deletedObjectCount = 0;
  const s3Failures = [];

  if (!isStorageConfigured()) {
    return { deletedObjectCount, s3Failures };
  }

  for (const src of USER_OWNED_URL_SOURCES) {
    const rows = await query(
      `SELECT ${src.column} AS url FROM ${src.table} WHERE ${src.where} AND ${src.column} IS NOT NULL`,
      [userId],
    );

    for (const row of rows) {
      try {
        const key = storageService.extractObjectKey(row.url);
        const segments = key ? key.split('/') : [];
        if (!segments.length || !storageService.VALID_PURPOSES.has(segments[0])) continue;
        await storageService.deleteObject(key, userId);
        deletedObjectCount += 1;
      } catch (err) {
        s3Failures.push({ table: src.table, url: row.url, error: err.message });
        console.warn(`[user-purge] failed to delete S3 object (${src.table}) for user ${userId}:`, err.message);
      }
    }
  }

  return { deletedObjectCount, s3Failures };
}

/**
 * Permanently purge a user: real S3 cleanup + real cascading DB delete.
 * Only ever call this on a user that's already soft-deleted (checked here defensively,
 * not just at the caller) — callers include both the manual admin "Delete Permanently"
 * endpoint and the grace-period cron script, so this is the single place the purge
 * logic lives.
 */
async function purgeUserById(id, actor) {
  const trashed = await adminService.getDeletedProfile(id);
  if (!trashed || !trashed.deleted_at) {
    return { purged: false, reason: 'not_trashed' };
  }

  const { deletedObjectCount, s3Failures } = await sweepUserStorage(id);

  const appUser = await findAppUserById(id);
  if (appUser) {
    await deleteAppUser(id); // cascades from app_users -> profiles -> everything
  } else {
    await adminService.deleteProfile(id); // orphan-profile fallback, cascades from profiles
  }

  await auditService.recordSafe({
    actor,
    action: 'user.purge',
    targetType: 'user',
    targetId: id,
    details: { deletedObjectCount, s3Failures: s3Failures.length ? s3Failures : undefined },
  });

  return { purged: true, deletedObjectCount, s3Failures };
}

module.exports = { purgeUserById };
