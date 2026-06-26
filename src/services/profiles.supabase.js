const { supabaseClient } = require('../config/supabase');

const PROFILE_UPDATE_DEFAULTS = {
  plan_type: 'free',
  plan_status: 'active',
  plan_currency: 'INR',
  streak: 0,
};

async function upsertProfile(row) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert(row, { onConflict: 'id', ignoreDuplicates: false })
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function getProfileById(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function updateProfile(userId, email, patch) {
  const row = {
    id: userId,
    email: email ?? null,
    ...PROFILE_UPDATE_DEFAULTS,
    ...patch,
  };

  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function touchLastActive(userId) {
  if (!userId) return;

  const { error } = await supabaseClient
    .from('profiles')
    .update({ last_active: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw error;
}

module.exports = {
  upsertProfile,
  getProfileById,
  updateProfile,
  touchLastActive,
};
