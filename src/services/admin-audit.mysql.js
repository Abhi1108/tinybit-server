const { randomUUID } = require('crypto');
const { execute } = require('../config/mysql');

async function record({ actor, action, targetType, targetId, details }) {
  await execute(
    `INSERT INTO admin_audit_log (id, actor, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      actor,
      action,
      targetType,
      targetId ?? null,
      details ? JSON.stringify(details) : null,
    ],
  );
}

// An audit-log write failure must never block the action it's recording.
async function recordSafe(entry) {
  try {
    await record(entry);
  } catch (err) {
    console.warn('[admin-audit] failed to write audit row:', err.message);
  }
}

module.exports = { record, recordSafe };
