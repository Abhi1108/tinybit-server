const { query, execute } = require('../config/mysql');

const SETTINGS_BOOL_COLUMNS = new Set([
  'voice_navigation',
  'vibration_alerts',
  'fall_detection',
  'night_mode',
]);

const SETTINGS_COLUMNS = [
  'voice_navigation',
  'vibration_alerts',
  'fall_detection',
  'night_mode',
  'font_scale',
  'language',
];

function serializeSettingValue(key, value) {
  if (SETTINGS_BOOL_COLUMNS.has(key)) {
    return value ? 1 : 0;
  }
  return value;
}

function parseSettingsRow(row) {
  if (!row) return null;

  const parsed = { ...row };
  for (const key of SETTINGS_BOOL_COLUMNS) {
    if (parsed[key] != null) {
      parsed[key] = Boolean(parsed[key]);
    }
  }
  if (parsed.font_scale != null) {
    parsed.font_scale = Number(parsed.font_scale);
  }
  return parsed;
}

async function getSettings(userId) {
  const rows = await query(
    `SELECT user_id, voice_navigation, vibration_alerts, fall_detection,
            night_mode, font_scale, language, updated_at
     FROM user_settings WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return parseSettingsRow(rows[0] ?? null);
}

async function upsertSettings(userId, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return getSettings(userId);
  }

  const columns = ['user_id', ...entries.map(([key]) => key)];
  const values = [
    userId,
    ...entries.map(([key, value]) => serializeSettingValue(key, value)),
  ];
  const placeholders = columns.map(() => '?').join(', ');
  const updates = entries
    .map(([key]) => `${key} = VALUES(${key})`)
    .join(', ');

  await execute(
    `INSERT INTO user_settings (${columns.join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
    values,
  );

  return getSettings(userId);
}

module.exports = {
  getSettings,
  upsertSettings,
};
