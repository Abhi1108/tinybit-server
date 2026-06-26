const { query, execute } = require('../config/mysql');

const PROFILE_JSON_COLUMNS = new Set(['medical_conditions', 'allergies']);

const PROFILE_UPDATE_DEFAULTS = {
  plan_type: 'free',
  plan_status: 'active',
  plan_currency: 'INR',
  streak: 0,
};

function serializeProfileValue(key, value) {
  if (value === undefined) return undefined;
  if (PROFILE_JSON_COLUMNS.has(key) && value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function parseProfileRow(row) {
  if (!row) return null;

  const parsed = { ...row };
  for (const key of PROFILE_JSON_COLUMNS) {
    if (parsed[key] == null) continue;
    if (typeof parsed[key] === 'string') {
      try {
        parsed[key] = JSON.parse(parsed[key]);
      } catch {
        // leave as-is
      }
    }
  }
  return parsed;
}

function buildUpsertSql(row) {
  const { id, ...fields } = row;
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);

  if (!id) {
    throw new Error('Profile id is required');
  }

  const columns = ['id', ...entries.map(([key]) => key)];
  const values = [id, ...entries.map(([key, value]) => serializeProfileValue(key, value))];
  const placeholders = columns.map(() => '?').join(', ');

  const updates = entries
    .map(([key]) => `${key} = VALUES(${key})`)
    .join(', ');

  const sql = updates.length > 0
    ? `INSERT INTO profiles (${columns.join(', ')})
       VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${updates}`
    : `INSERT INTO profiles (id) VALUES (?)
       ON DUPLICATE KEY UPDATE id = id`;

  return { sql, values };
}

async function upsertProfile(row) {
  const { sql, values } = buildUpsertSql(row);
  await execute(sql, values);

  return getProfileById(row.id);
}

async function getProfileById(userId) {
  const rows = await query('SELECT * FROM profiles WHERE id = ? LIMIT 1', [userId]);
  return parseProfileRow(rows[0] ?? null);
}

async function updateProfile(userId, email, patch) {
  const row = {
    id: userId,
    email: email ?? null,
    ...PROFILE_UPDATE_DEFAULTS,
    ...patch,
  };

  return upsertProfile(row);
}

async function touchLastActive(userId) {
  if (!userId) return;

  await execute(
    'UPDATE profiles SET last_active = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [userId],
  );
}

module.exports = {
  upsertProfile,
  getProfileById,
  updateProfile,
  touchLastActive,
};
