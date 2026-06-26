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

/** DELETE /api/medicines/:id */
async function deleteMedicine(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { data, error } = await supabaseClient
      .from('medicines')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[medicines] delete:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
      }
      return res.status(500).json({ success: false, message: 'Could not delete medicine.' });
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    return res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('[medicines] delete', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not delete medicine.' });
  }
}

module.exports = {
  listMedicines,
  getMedicine,
  createMedicines,
  updateMedicine,
  deleteMedicine,
};
