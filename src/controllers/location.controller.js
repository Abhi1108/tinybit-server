const elderLocationsService = require('../services/elder-locations.service');
const { query } = require('../config/mysql');
const { notifyGuardiansOfElder } = require('../services/notifications.service');

const LOCATION_UPDATE_MAX_PER_DAY = 3;
const LOCATION_UPDATE_MIN_GAP_MS = 5 * 60 * 60 * 1000;

/**
 * Throttles the "Location Update" guardian push to at most 3/day, at least 5h apart.
 * notifyGuardiansOfElder writes one notifications row per connected guardian, so a
 * single send can produce several rows with (near-)identical timestamps — bucketing
 * by minute collapses those into one logical "send" for counting purposes.
 */
async function shouldSendLocationUpdate(elderId) {
  const todayMidnight = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const rows = await query(
    `SELECT created_at FROM notifications
     WHERE sender_id = ? AND type = 'location_update' AND created_at >= ?
     ORDER BY created_at DESC`,
    [elderId, todayMidnight],
  );

  const sendBuckets = new Set(rows.map((r) => new Date(r.created_at).toISOString().slice(0, 16)));
  if (sendBuckets.size >= LOCATION_UPDATE_MAX_PER_DAY) return false;

  if (rows.length > 0 && Date.now() - new Date(rows[0].created_at).getTime() < LOCATION_UPDATE_MIN_GAP_MS) {
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
            type: 'location_update',
            title: 'Location Update',
            body: "The user's live location has been updated.",
            data: { type: 'location_update', elderId: userId },
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
