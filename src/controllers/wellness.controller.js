const { supabaseClient } = require('../config/supabase');

function isTableMissing(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function todayDateStr() {
  return new Date().toISOString().split('T')[0];
}

function normalizeSleepQuality(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const map = { excellent: 3, good: 2, poor: 1 };
  if (map[value] != null) return map[value];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBody(req) {
  return req.body ?? {};
}

/** GET /api/wellness/daily-checkin/today */
async function getTodayCheckIn(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const date = String(req.query.date ?? todayDateStr()).trim() || todayDateStr();

    const { data, error } = await supabaseClient
      .from('daily_checkins')
      .select('*')
      .eq('user_id', userId)
      .eq('check_in_date', date)
      .maybeSingle();

    if (error) {
      console.error('[wellness/daily-checkin] get:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'daily_checkins table is not deployed. Run migration 012_daily_checkins.sql.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not load check-in.' });
    }

    return res.json({ success: true, checkIn: data ?? null });
  } catch (err) {
    console.error('[wellness/daily-checkin] get', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load check-in.' });
  }
}

/** POST /api/wellness/daily-checkin — upsert one row per user per day */
async function upsertDailyCheckIn(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const {
      user_id: _ignoredUserId,
      id: _ignoredId,
      created_at: _ignoredCreatedAt,
      updated_at: _ignoredUpdatedAt,
      ...fields
    } = body;

    if (!fields.mood) {
      return res.status(400).json({ success: false, message: 'Please select your mood.' });
    }

    const payload = {
      ...fields,
      user_id:       userId,
      check_in_date: String(fields.check_in_date ?? todayDateStr()).trim() || todayDateStr(),
    };

    if ('sleep_quality' in payload) {
      payload.sleep_quality = normalizeSleepQuality(payload.sleep_quality);
    }

    const { data, error } = await supabaseClient
      .from('daily_checkins')
      .upsert(payload, { onConflict: 'user_id,check_in_date' })
      .select('*')
      .single();

    if (error) {
      console.error('[wellness/daily-checkin] upsert:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'daily_checkins table is not deployed. Run migration 012_daily_checkins.sql.',
        });
      }
      return res.status(500).json({ success: false, message: error.message || 'Could not save check-in.' });
    }

    return res.json({ success: true, checkIn: data });
  } catch (err) {
    console.error('[wellness/daily-checkin] upsert', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save check-in.' });
  }
}

/** POST /api/wellness/health-metrics — optional vitals (non-blocking on client). */
async function insertHealthMetrics(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const readings = readBody(req).readings;
    if (!Array.isArray(readings) || readings.length === 0) {
      return res.json({ success: true, inserted: 0 });
    }

    const rows = readings
      .map((row) => ({
        user_id: userId,
        type: String(row.vital_type ?? row.type ?? '').trim(),
        value: Number(row.value),
        unit: String(row.unit ?? '').trim(),
      }))
      .filter((row) => row.type && Number.isFinite(row.value));

    if (rows.length === 0) {
      return res.json({ success: true, inserted: 0 });
    }

    const { error } = await supabaseClient.from('health_readings').insert(rows);

    if (error) {
      console.error('[wellness/health-metrics] insert:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'health_readings table is not deployed.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not save health metrics.' });
    }

    return res.json({ success: true, inserted: rows.length });
  } catch (err) {
    console.error('[wellness/health-metrics] insert', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save health metrics.' });
  }
}

module.exports = {
  getTodayCheckIn,
  upsertDailyCheckIn,
  insertHealthMetrics,
};
