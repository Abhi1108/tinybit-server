const { supabaseClient } = require('../config/supabase');

const LOCATION_COLUMNS = 'elder_id, latitude, longitude, accuracy, address, is_sharing, updated_at';

async function getByElderId(elderId) {
  const { data, error } = await supabaseClient
    .from('elder_locations')
    .select(LOCATION_COLUMNS)
    .eq('elder_id', elderId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function upsert(elderId, payload) {
  const row = {
    elder_id: elderId,
    latitude: payload.latitude,
    longitude: payload.longitude,
    updated_at: new Date().toISOString(),
  };

  if (payload.accuracy !== undefined) {
    row.accuracy = payload.accuracy;
  }
  if (payload.address !== undefined) {
    row.address = payload.address;
  }
  if (payload.is_sharing !== undefined) {
    row.is_sharing = payload.is_sharing;
  }

  const { data, error } = await supabaseClient
    .from('elder_locations')
    .upsert(row, { onConflict: 'elder_id' })
    .select(LOCATION_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  getByElderId,
  upsert,
};
