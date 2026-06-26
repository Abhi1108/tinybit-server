const { supabaseClient } = require('../config/supabase');

function normalizeReadings(userId, readings) {
  return readings
    .map((row) => ({
      user_id: userId,
      type: String(row.vital_type ?? row.type ?? '').trim(),
      value: Number(row.value),
      unit: String(row.unit ?? '').trim(),
    }))
    .filter((row) => row.type && Number.isFinite(row.value));
}

async function insertHealthReadings(userId, readings) {
  const rows = normalizeReadings(userId, readings);
  if (rows.length === 0) return 0;

  const { error } = await supabaseClient.from('health_readings').insert(rows);
  if (error) throw error;
  return rows.length;
}

module.exports = {
  insertHealthReadings,
};
