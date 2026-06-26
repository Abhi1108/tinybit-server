const { supabaseClient } = require('../config/supabase');

const UPSERT_FIELDS = [
  'mood',
  'mood_score',
  'sleep_rested',
  'breakfast_done',
  'hydration_done',
  'pain_reported',
  'water_glasses',
  'medicines_taken',
  'sleep_quality',
  'sleep_hours',
  'energy_level',
  'pain_level',
  'physical_activity',
  'voice_note_url',
  'voice_note_duration',
  'notes',
];

function pickUpsertFields(fields) {
  const out = {};
  for (const key of UPSERT_FIELDS) {
    if (fields[key] !== undefined) {
      out[key] = fields[key];
    }
  }
  return out;
}

async function findCheckInByUserAndDate(userId, date) {
  const { data, error } = await supabaseClient
    .from('daily_checkins')
    .select('*')
    .eq('user_id', userId)
    .eq('check_in_date', date)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function upsertDailyCheckIn(userId, fields) {
  const payload = {
    ...pickUpsertFields(fields),
    user_id: userId,
    check_in_date: fields.check_in_date,
  };

  const { data, error } = await supabaseClient
    .from('daily_checkins')
    .upsert(payload, { onConflict: 'user_id,check_in_date' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  findCheckInByUserAndDate,
  upsertDailyCheckIn,
};
