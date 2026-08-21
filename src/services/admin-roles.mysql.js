const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const PERMISSION_CATALOG = [
  'All Modules',
  'Dashboard',
  'Dashboard (Read)',
  'User Management',
  'Users (Read)',
  'Admin Management',
  'Content Management',
  'FAQ Management',
  'SOS Management',
  'SOS (Read)',
  'Support Tickets',
  'User Queries',
  'Chat Support',
  'Escalation',
  'Notifications',
  'Notifications (Read)',
  'Billing',
  'AI Management',
  'Settings',
  'Leaderboard & Rewards',
];

const SYSTEM_SUPER_ADMIN_ID = 'a0000001-0000-4000-8000-000000000001';

function parsePermissions(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeRole(row, userCount = 0) {
  if (!row) return null;
  const permissions = parsePermissions(row.permissions);
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    description: row.description ?? '',
    permissions,
    status: row.status,
    is_system: Boolean(row.is_system),
    user_count: Number(userCount) || 0,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function slugifyName(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
}

async function listRoles() {
  const rows = await query(
    `SELECT r.id, r.name, r.label, r.description, r.permissions, r.status, r.is_system,
            r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM admin_users u WHERE u.role_id = r.id) AS user_count
     FROM admin_roles r
     ORDER BY r.is_system DESC, r.label ASC`,
  );
  return rows.map((r) => normalizeRole(r, r.user_count));
}

async function findById(id) {
  const rows = await query(
    `SELECT id, name, label, description, permissions, status, is_system, created_at, updated_at
     FROM admin_roles WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? normalizeRole(rows[0]) : null;
}

async function findByName(name) {
  const rows = await query(
    `SELECT id, name, label, description, permissions, status, is_system, created_at, updated_at
     FROM admin_roles WHERE name = ? LIMIT 1`,
    [name],
  );
  return rows[0] ? normalizeRole(rows[0]) : null;
}

async function createRole({ label, description, permissions, status = 'active' }) {
  const name = slugifyName(label);
  if (!name) {
    const err = new Error('label is required');
    err.status = 400;
    throw err;
  }
  if (name === 'super_admin') {
    const err = new Error('Cannot create another super_admin role');
    err.status = 409;
    throw err;
  }
  const perms = Array.isArray(permissions) ? permissions.map(String) : [];
  const id = randomUUID();
  await execute(
    `INSERT INTO admin_roles (id, name, label, description, permissions, status, is_system)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      name,
      String(label).trim(),
      description != null ? String(description) : null,
      JSON.stringify(perms),
      status === 'inactive' ? 'inactive' : 'active',
    ],
  );
  return findById(id);
}

async function updateRole(id, { label, description, permissions, status }) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }

  const fields = [];
  const params = [];

  if (existing.name === 'super_admin') {
    // Super Admin role stays locked to full access; allow description/label only.
    if (label !== undefined) {
      fields.push('label = ?');
      params.push(String(label).trim());
    }
    if (description !== undefined) {
      fields.push('description = ?');
      params.push(description != null ? String(description) : null);
    }
    fields.push('permissions = ?');
    params.push(JSON.stringify(['*']));
  } else {
    if (label !== undefined) {
      fields.push('label = ?');
      params.push(String(label).trim());
    }
    if (description !== undefined) {
      fields.push('description = ?');
      params.push(description != null ? String(description) : null);
    }
    if (permissions !== undefined) {
      const perms = Array.isArray(permissions) ? permissions.map(String) : [];
      fields.push('permissions = ?');
      params.push(JSON.stringify(perms));
    }
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        const err = new Error('status must be active or inactive');
        err.status = 400;
        throw err;
      }
      fields.push('status = ?');
      params.push(status);
    }
  }

  if (!fields.length) return existing;
  params.push(id);
  await execute(`UPDATE admin_roles SET ${fields.join(', ')} WHERE id = ?`, params);
  return findById(id);
}

async function deleteRole(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }
  if (existing.is_system) {
    const err = new Error('System roles cannot be deleted');
    err.status = 400;
    throw err;
  }
  const [{ cnt }] = await query('SELECT COUNT(*) AS cnt FROM admin_users WHERE role_id = ?', [id]);
  if (Number(cnt) > 0) {
    const err = new Error('Role is still assigned to admin users');
    err.status = 409;
    throw err;
  }
  await execute('DELETE FROM admin_roles WHERE id = ?', [id]);
  return true;
}

function hasPermission(permissions, ...required) {
  const perms = Array.isArray(permissions) ? permissions : [];
  if (perms.includes('*') || perms.includes('All Modules')) return true;
  return required.some((key) => perms.includes(key));
}

module.exports = {
  PERMISSION_CATALOG,
  SYSTEM_SUPER_ADMIN_ID,
  listRoles,
  findById,
  findByName,
  createRole,
  updateRole,
  deleteRole,
  hasPermission,
  parsePermissions,
  normalizeRole,
};
