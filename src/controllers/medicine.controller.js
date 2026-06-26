const { supabaseClient } = require('../config/supabase');

function isTableMissing(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function readBody(req) {
  return req.body ?? {};
}

const MEDICINE_COLUMNS = [
  'id', 'user_id', 'name', 'generic_name', 'dosage', 'dosage_unit',
  'schedule_time', 'time', 'days_of_week', 'instruction', 'notes',
  'prescribed_by', 'frequency', 'start_date', 'end_date', 'is_recurring',
  'priority', 'category', 'stock', 'total_stock', 'is_active',
  'snooze_minutes', 'meal_timing', 'created_at',
].join(', ');

/** GET /api/medicines */
async function listMedicines(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const activeOnly = String(req.query.active ?? 'true').toLowerCase() !== 'false';

    let query = supabaseClient
      .from('medicines')
      .select(MEDICINE_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[medicines] list:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'medicines table is not deployed.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not load medicines.' });
    }

    return res.json({ success: true, medicines: data ?? [] });
  } catch (err) {
    console.error('[medicines] list', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load medicines.' });
  }
}

/** GET /api/medicines/:id */
async function getMedicine(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { data, error } = await supabaseClient
      .from('medicines')
      .select(MEDICINE_COLUMNS)
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[medicines] get:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
      }
      return res.status(500).json({ success: false, message: 'Could not load medicine.' });
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    return res.json({ success: true, medicine: data });
  } catch (err) {
    console.error('[medicines] get', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load medicine.' });
  }
}

/** POST /api/medicines — body: single row or { medicines: [...] } */
async function createMedicines(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const rawRows = Array.isArray(body.medicines) ? body.medicines : [body];

    const rows = rawRows.map((row) => {
      const { user_id: _ignored, id: _id, created_at: _ca, ...fields } = row ?? {};
      return { ...fields, user_id: userId };
    });

    if (rows.length === 0 || !rows[0]?.name?.trim()) {
      return res.status(400).json({ success: false, message: 'Medicine name is required.' });
    }

    const { data, error } = await supabaseClient
      .from('medicines')
      .insert(rows)
      .select(MEDICINE_COLUMNS);

    if (error) {
      console.error('[medicines] insert:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
      }
      return res.status(500).json({ success: false, message: 'Could not save medicine.' });
    }

    return res.json({ success: true, medicines: data ?? [] });
  } catch (err) {
    console.error('[medicines] create', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save medicine.' });
  }
}

/** PATCH /api/medicines/:id */
async function updateMedicine(req, res) {
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
      ...patch
    } = body;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    const { data, error } = await supabaseClient
      .from('medicines')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select(MEDICINE_COLUMNS)
      .single();

    if (error) {
      console.error('[medicines] update:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
      }
      return res.status(500).json({ success: false, message: 'Could not update medicine.' });
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    return res.json({ success: true, medicine: data });
  } catch (err) {
    console.error('[medicines] update', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not update medicine.' });
  }
}

function dayRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 7);
  d.setMilliseconds(-1);
  return d;
}

/** GET /api/medicines/logs — ?from=&to= ISO or ?scope=day|week */
async function listMedicineLogs(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const scope = String(req.query.scope ?? '').toLowerCase();
    let from = req.query.from ? String(req.query.from) : null;
    let to = req.query.to ? String(req.query.to) : null;

    if (!from || !to) {
      const base = new Date();
      if (scope === 'week') {
        from = startOfWeek(base).toISOString();
        to = endOfWeek(base).toISOString();
      } else {
        const range = dayRange(base);
        from = range.start;
        to = range.end;
      }
    }

    const { data, error } = await supabaseClient
      .from('medicine_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('taken_at', from)
      .lte('taken_at', to);

    if (error) {
      console.error('[medicines] logs list:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({ success: false, message: 'medicine_logs table is not deployed.' });
      }
      return res.status(500).json({ success: false, message: 'Could not load medicine logs.' });
    }

    return res.json({ success: true, logs: data ?? [] });
  } catch (err) {
    console.error('[medicines] logs list', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load medicine logs.' });
  }
}

/** POST /api/medicines/logs/toggle — { medicine_id, taken, date? } */
async function toggleMedicineLog(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const medicineId = String(body.medicine_id ?? '').trim();
    const taken = Boolean(body.taken);
    const date = body.date ? new Date(String(body.date)) : new Date();

    if (!medicineId) {
      return res.status(400).json({ success: false, message: 'medicine_id is required.' });
    }

    const { start, end } = dayRange(date);

    if (taken) {
      const { data: existing, error: existingError } = await supabaseClient
        .from('medicine_logs')
        .select('*')
        .eq('user_id', userId)
        .eq('medicine_id', medicineId)
        .gte('taken_at', start)
        .lte('taken_at', end)
        .maybeSingle();

      if (existingError) {
        console.error('[medicines] logs toggle existing:', existingError.message);
        return res.status(500).json({ success: false, message: 'Could not update medicine log.' });
      }

      if (existing) {
        return res.json({ success: true, log: existing });
      }

      const takenAt = new Date(date);
      const now = new Date();
      takenAt.setHours(now.getHours(), now.getMinutes(), 0, 0);

      const { data, error } = await supabaseClient
        .from('medicine_logs')
        .insert({
          user_id:     userId,
          medicine_id: medicineId,
          taken_at:    takenAt.toISOString(),
        })
        .select('*')
        .single();

      if (error) {
        console.error('[medicines] logs toggle insert:', error.message);
        if (isTableMissing(error)) {
          return res.status(501).json({ success: false, message: 'medicine_logs table is not deployed.' });
        }
        return res.status(500).json({ success: false, message: 'Could not update medicine log.' });
      }

      return res.json({ success: true, log: data });
    }

    const { error } = await supabaseClient
      .from('medicine_logs')
      .delete()
      .eq('user_id', userId)
      .eq('medicine_id', medicineId)
      .gte('taken_at', start)
      .lte('taken_at', end);

    if (error) {
      console.error('[medicines] logs toggle delete:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({ success: false, message: 'medicine_logs table is not deployed.' });
      }
      return res.status(500).json({ success: false, message: 'Could not update medicine log.' });
    }

    return res.json({ success: true, log: null });
  } catch (err) {
    console.error('[medicines] logs toggle', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not update medicine log.' });
  }
}

module.exports = {
  listMedicines,
  getMedicine,
  createMedicines,
  updateMedicine,
  listMedicineLogs,
  toggleMedicineLog,
};
