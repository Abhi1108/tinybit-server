const { supabaseClient } = require('../config/supabase');

const CONTACT_COLUMNS = 'id, name, role, phone, color';

async function listByUserId(userId) {
  const { data, error } = await supabaseClient
    .from('emergency_contacts')
    .select(CONTACT_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function create(userId, { name, role, phone, color }) {
  const { data, error } = await supabaseClient
    .from('emergency_contacts')
    .insert({ user_id: userId, name, role, phone, color })
    .select(CONTACT_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

async function update(userId, contactId, patch) {
  const { data, error } = await supabaseClient
    .from('emergency_contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('user_id', userId)
    .select(CONTACT_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function remove(userId, contactId) {
  const { data, error } = await supabaseClient
    .from('emergency_contacts')
    .delete()
    .eq('id', contactId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return data;
}

module.exports = {
  listByUserId,
  create,
  update,
  remove,
};
