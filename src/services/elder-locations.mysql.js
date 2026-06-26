const { query, execute } = require('../config/mysql');

const LOCATION_COLUMNS = 'elder_id, latitude, longitude, accuracy, address, is_sharing, updated_at';

function mapLocationRow(row) {
  if (!row) return null;
  return {
    elder_id: row.elder_id,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    address: row.address,
    is_sharing: Boolean(row.is_sharing),
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at,
  };
}

async function getByElderId(elderId) {
  const rows = await query(
    `SELECT ${LOCATION_COLUMNS}
     FROM elder_locations
     WHERE elder_id = ?
     LIMIT 1`,
    [elderId],
  );
  return mapLocationRow(rows[0]);
}

async function upsert(elderId, payload) {
  const existing = await getByElderId(elderId);

  if (existing) {
    const sets = ['latitude = ?', 'longitude = ?', 'updated_at = CURRENT_TIMESTAMP(3)'];
    const params = [payload.latitude, payload.longitude];

    if (payload.accuracy !== undefined) {
      sets.push('accuracy = ?');
      params.push(payload.accuracy);
    }
    if (payload.address !== undefined) {
      sets.push('address = ?');
      params.push(payload.address);
    }
    if (payload.is_sharing !== undefined) {
      sets.push('is_sharing = ?');
      params.push(payload.is_sharing ? 1 : 0);
    }

    params.push(elderId);
    await execute(
      `UPDATE elder_locations
       SET ${sets.join(', ')}
       WHERE elder_id = ?`,
      params,
    );
  } else {
    await execute(
      `INSERT INTO elder_locations (
         elder_id, latitude, longitude, accuracy, address, is_sharing
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        elderId,
        payload.latitude,
        payload.longitude,
        payload.accuracy ?? null,
        payload.address ?? null,
        payload.is_sharing ? 1 : 0,
      ],
    );
  }

  return getByElderId(elderId);
}

module.exports = {
  getByElderId,
  upsert,
};
