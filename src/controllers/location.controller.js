const elderLocationsService = require('../services/elder-locations.service');
const { query } = require('../config/mysql');
const { notifyGuardiansOfElder } = require('../services/notifications.service');
const { NOTIFICATION_TYPES } = require('../constants/notification-types');
const { getUserTimezone } = require('../services/timezone.service');
const { todayForTimezone, dateOnlyForTimezone } = require('../utils/date');

const LOCATION_UPDATE_MAX_PER_DAY = 3;
const LOCATION_UPDATE_MIN_GAP_MS = 5 * 60 * 60 * 1000;
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Throttles the "Location Update" guardian push to at most 3/day, at least 5h apart —
 * scoped to this elder's own calendar day (their stored timezone), not a fixed server
 * offset. Pulls a generously wide raw window (48h — wider than any possible UTC offset
 * span) and buckets precisely by the elder's own day in JS, same pattern as
 * `calculateMedicineStreak`. notifyGuardiansOfElder writes one notifications row per
 * connected guardian, so a single send can produce several rows with (near-)identical
 * timestamps — bucketing by minute collapses those into one logical "send" for counting.
 */
async function shouldSendLocationUpdate(elderId) {
  const timezone = await getUserTimezone(elderId);
  const today = todayForTimezone(timezone);

  const rows = await query(
    `SELECT created_at FROM notifications
     WHERE sender_id = ? AND type = 'location_update' AND created_at >= ?
     ORDER BY created_at DESC`,
    [elderId, new Date(Date.now() - LOOKBACK_MS)],
  );
  const todaysRows = rows.filter((r) => dateOnlyForTimezone(new Date(r.created_at), timezone) === today);

  const sendBuckets = new Set(todaysRows.map((r) => new Date(r.created_at).toISOString().slice(0, 16)));
  if (sendBuckets.size >= LOCATION_UPDATE_MAX_PER_DAY) return false;

  if (todaysRows.length > 0 && Date.now() - new Date(todaysRows[0].created_at).getTime() < LOCATION_UPDATE_MIN_GAP_MS) {
    return false;
  }

  return true;
}

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function readBody(req) {
  return req.body ?? {};
}

/** GET /api/location — own elder_locations row */
async function getLocation(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const location = await elderLocationsService.getByElderId(userId);
    return res.json({ success: true, location });
  } catch (err) {
    console.error('[location] get:', err.message || err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'elder_locations table is not deployed. Run migration 011_elder_locations.sql.',
      });
    }
    return res.status(500).json({ success: false, message: 'Could not load location.' });
  }
}

/** PUT /api/location — upsert elder location (onConflict elder_id) */
async function upsertLocation(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, message: 'latitude and longitude are required.' });
    }

    const payload = { latitude, longitude };

    if (body.accuracy !== undefined && body.accuracy !== null) {
      const accuracy = Number(body.accuracy);
      if (Number.isFinite(accuracy)) payload.accuracy = accuracy;
    }

    if (body.address !== undefined) {
      payload.address = String(body.address ?? '').trim() || null;
    }

    if (body.is_sharing !== undefined) {
      payload.is_sharing = Boolean(body.is_sharing);
    }

    const location = await elderLocationsService.upsert(userId, payload);

    if (location.is_sharing) {
      try {
        if (await shouldSendLocationUpdate(userId)) {
          await notifyGuardiansOfElder(userId, {
            type: NOTIFICATION_TYPES.LOCATION_UPDATE,
            title: 'Location Update',
            body: "The user's live location has been updated.",
            data: { type: NOTIFICATION_TYPES.LOCATION_UPDATE, elderId: userId },
          });
        }
      } catch (notifyErr) {
        console.warn('[location/upsert] guardian notify failed:', notifyErr.message);
      }
    }

    return res.json({ success: true, location });
  } catch (err) {
    console.error('[location] upsert:', err.message || err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'elder_locations table is not deployed. Run migration 011_elder_locations.sql.',
      });
    }
    return res.status(500).json({ success: false, message: err.message || 'Could not save location.' });
  }
}

module.exports = {
  getLocation,
  upsertLocation,
};
