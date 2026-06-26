const { supabaseClient } = require('../config/supabase');

/** Minimal profile fields for SOS trigger logging. */
async function getProfileForTrigger(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('full_name, emergency_name, emergency_phone, mobile')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  getProfileForTrigger,
};
