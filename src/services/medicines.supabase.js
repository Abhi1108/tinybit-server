const { supabaseClient } = require('../config/supabase');

const MEDICINE_COLUMNS = [
  'id', 'user_id', 'name', 'generic_name', 'dosage', 'dosage_unit',
  'schedule_time', 'time', 'days_of_week', 'instruction', 'notes',
  'prescribed_by', 'frequency', 'start_date', 'end_date', 'is_recurring',
  'priority', 'category', 'stock', 'total_stock', 'is_active',
  'snooze_minutes', 'meal_timing', 'created_at',
].join(', ');

function stripProtectedFields(row) {
  const {
    user_id: _ignoredUserId,
    id: _ignoredId,
    created_at: _ignoredCreatedAt,
    updated_at: _ignoredUpdatedAt,
    ...fields
  } = row ?? {};
  return fields;
}

async function listByUser(userId, { activeOnly = true } = {}) {
  let query = supabaseClient
    .from('medicines')
    .select(MEDICINE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function getById(userId, id) {
  const { data, error } = await supabaseClient
    .from('medicines')
    .select(MEDICINE_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function create(userId, rawRows) {
  const rows = rawRows.map((row) => ({
    ...stripProtectedFields(row),
    user_id: userId,
  }));

  const { data, error } = await supabaseClient
    .from('medicines')
    .insert(rows)
    .select(MEDICINE_COLUMNS);

  if (error) throw error;
  return data ?? [];
}

async function update(userId, id, patch) {
  const fields = stripProtectedFields(patch);

  const { data, error } = await supabaseClient
    .from('medicines')
    .update(fields)
    .eq('id', id)
    .eq('user_id', userId)
    .select(MEDICINE_COLUMNS)
    .single();

  if (error) throw error;
  return data ?? null;
}

async function deleteById(userId, id) {
  const { data, error } = await supabaseClient
    .from('medicines')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

module.exports = {
  listByUser,
  getById,
  create,
  update,
  delete: deleteById,
};
