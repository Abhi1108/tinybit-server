const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function toIso(val) {
  if (!val) return val;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function parseDetails(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

function normalizeLog(row) {
  return {
    ...row,
    details: parseDetails(row.details),
    created_at: toIso(row.created_at),
  };
}

async function record({ actor, action, targetType, targetId, details, ip }) {
  await execute(
    `INSERT INTO admin_audit_log (id, actor, action, target_type, target_id, details, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      actor,
      action,
      targetType,
      targetId ?? null,
      details ? JSON.stringify(details) : null,
      ip ?? null,
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

function buildLogFilters({ action, search }) {
  const clauses = [];
  const params = [];

  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }

  const term = String(search ?? '').trim();
  if (term) {
    const like = `%${term.replace(/[%_]/g, '')}%`;
    clauses.push('(actor LIKE ? OR action LIKE ? OR target_id LIKE ? OR ip LIKE ?)');
    params.push(like, like, like, like);
  }

  return { where: clauses.length ? clauses.join(' AND ') : '1=1', params };
}

async function list({ page, limit, action, search }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const { where, params } = buildLogFilters({ action, search });

  const [totalRows, rows] = await Promise.all([
    query(`SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE ${where}`, params),
    query(
      `SELECT id, actor, action, target_type, target_id, details, ip, created_at
       FROM admin_audit_log
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    ),
  ]);

  return {
    logs: rows.map(normalizeLog),
    total: Number(totalRows[0]?.cnt ?? rows.length),
    page: pageNum,
    limit: limitNum,
  };
}

async function listAll({ limit = 5000 } = {}) {
  const limitNum = Math.min(5000, Math.max(1, parseInt(limit, 10) || 5000));
  const rows = await query(
    `SELECT id, actor, action, target_type, target_id, details, ip, created_at
     FROM admin_audit_log
     ORDER BY created_at DESC
     LIMIT ${limitNum}`,
  );
  return rows.map(normalizeLog);
}

module.exports = { record, recordSafe, list, listAll };
