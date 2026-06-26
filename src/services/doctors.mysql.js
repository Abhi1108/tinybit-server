const { query } = require('../config/mysql');

const DOCTOR_SELECT = `
  id, name, specialty, rating, experience, fee, address, image_url,
  is_active, sort_order, created_at, updated_at
`;

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapDoctorRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    rating: row.rating == null ? null : Number(row.rating),
    experience: row.experience,
    fee: row.fee,
    address: row.address ?? null,
    image_url: row.image_url ?? null,
    is_active: Boolean(row.is_active),
    sort_order: row.sort_order == null ? 0 : Number(row.sort_order),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

async function listActive() {
  const rows = await query(
    `SELECT ${DOCTOR_SELECT}
     FROM doctors
     WHERE is_active = 1
     ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map(mapDoctorRow);
}

async function listBySpecialty(specialty) {
  if (!specialty) {
    return listActive();
  }

  const rows = await query(
    `SELECT ${DOCTOR_SELECT}
     FROM doctors
     WHERE is_active = 1 AND specialty = ?
     ORDER BY sort_order ASC, name ASC`,
    [specialty],
  );
  return rows.map(mapDoctorRow);
}

async function getById(id) {
  const rows = await query(
    `SELECT ${DOCTOR_SELECT}
     FROM doctors
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [id],
  );
  return mapDoctorRow(rows[0] ?? null);
}

module.exports = {
  listBySpecialty,
  getById,
  listActive,
};
