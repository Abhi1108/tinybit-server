const { supabaseClient } = require('../config/supabase');

const USER_SETTINGS_COLUMNS =
  'user_id, voice_navigation, vibration_alerts, fall_detection, night_mode, font_scale, language, updated_at';

async function getSettings(userId) {
  const { data, error } = await supabaseClient
    .from('user_settings')
    .select(USER_SETTINGS_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return null;
    }
    throw error;
  }

  return data ?? null;
}

async function upsertSettings(userId, patch) {
  const { data, error } = await supabaseClient
    .from('user_settings')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    .select(USER_SETTINGS_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  getSettings,
  upsertSettings,
};
