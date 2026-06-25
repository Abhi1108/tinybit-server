const { supabaseClient } = require('../config/supabase');

function isTableMissing(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
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

    const { data, error } = await supabaseClient
      .from('elder_locations')
      .select('elder_id, latitude, longitude, accuracy, address, is_sharing, updated_at')
      .eq('elder_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[location] get:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'elder_locations table is not deployed. Run migration 011_elder_locations.sql.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not load location.' });
    }

    return res.json({ success: true, location: data ?? null });
  } catch (err) {
    console.error('[location] get', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load location.' });
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

    const payload = {
      elder_id: userId,
      latitude,
      longitude,
      updated_at: new Date().toISOString(),
    };

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

    const { data, error } = await supabaseClient
      .from('elder_locations')
      .upsert(payload, { onConflict: 'elder_id' })
      .select('elder_id, latitude, longitude, accuracy, address, is_sharing, updated_at')
      .single();

    if (error) {
      console.error('[location] upsert:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'elder_locations table is not deployed. Run migration 011_elder_locations.sql.',
        });
      }
      return res.status(500).json({ success: false, message: error.message || 'Could not save location.' });
    }

    return res.json({ success: true, location: data });
  } catch (err) {
    console.error('[location] upsert', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save location.' });
  }
}

module.exports = {
  getLocation,
  upsertLocation,
};
