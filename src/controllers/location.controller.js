const elderLocationsService = require('../services/elder-locations.service');

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
    const userId = req.auth?.userId ?? req.supabase?.userId;
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
    const userId = req.auth?.userId ?? req.supabase?.userId;
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
