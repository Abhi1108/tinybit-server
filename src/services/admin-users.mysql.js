const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const adminRolesService = require('./admin-roles.mysql');

const BCRYPT_ROUNDS = 12;

function normalizeRow(row) {
  if (!row) return null;
  const rolePermissions = adminRolesService.parsePermissions(row.role_permissions);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role_id: row.role_id,
    status: row.status,
    last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    created_by: row.created_by ?? null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    role: row.role_name
      ? {
          id: row.role_id,
          name: row.role_name,
          label: row.role_label,
          permissions: rolePermissions,
          status: row.role_status,
        }
      : null,
  };
}

const SELECT_WITH_ROLE = `
  SELECT u.id, u.username, u.email, u.name, u.role_id, u.status, u.password_hash,
         u.last_login_at, u.created_by, u.created_at, u.updated_at,
         r.name AS role_name, r.label AS role_label, r.permissions AS role_permissions,
         r.status AS role_status
  FROM admin_users u
  LEFT JOIN admin_roles r ON r.id = u.role_id
`;

async function listAdmins({ search, status } = {}) {
  const clauses = [];
  const params = [];
  if (status && status !== 'all') {
    clauses.push('u.status = ?');
    params.push(status);
  }
  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    clauses.push('(u.username LIKE ? OR u.email LIKE ? OR u.name LIKE ?)');
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `${SELECT_WITH_ROLE}
     ${where}
     ORDER BY u.created_at DESC`,
    params,
  );
  return rows.map((r) => {
    const { password_hash, ...rest } = r;
    return normalizeRow(rest);
  });
}

async function findById(id) {
  const rows = await query(`${SELECT_WITH_ROLE} WHERE u.id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

async function findByLogin(login) {
  const value = String(login ?? '').trim();
  if (!value) return null;
  const rows = await query(
    `${SELECT_WITH_ROLE}
     WHERE u.username = ? OR u.email = ?
     LIMIT 1`,
    [value, value],
  );
  return rows[0] ?? null;
}

async function verifyPassword(row, password) {
  if (!row?.password_hash) return false;
  return bcrypt.compare(String(password ?? ''), row.password_hash);
}

async function touchLastLogin(id) {
  await execute('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [id]);
}

async function createAdmin({ username, email, name, password, roleId, createdBy }) {
  const role = await adminRolesService.findById(roleId);
  if (!role) {
    const err = new Error('role_id is invalid');
    err.status = 400;
    throw err;
  }
  if (role.status !== 'active') {
    const err = new Error('Cannot assign an inactive role');
    err.status = 400;
    throw err;
  }
  if (role.name === 'super_admin') {
    const err = new Error('Cannot assign the Super Admin role to managed accounts');
    err.status = 400;
    throw err;
  }

  const id = randomUUID();
  const password_hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  await execute(
    `INSERT INTO admin_users (id, username, email, name, password_hash, role_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      id,
      String(username).trim(),
      String(email).trim().toLowerCase(),
      String(name).trim(),
      password_hash,
      roleId,
      createdBy ?? null,
    ],
  );
  const row = await findById(id);
  const { password_hash: _, ...rest } = row;
  return normalizeRow(rest);
}

async function updateAdmin(id, { name, email, status, roleId }) {
  const fields = [];
  const params = [];
  if (name !== undefined) {
    fields.push('name = ?');
    params.push(String(name).trim());
  }
  if (email !== undefined) {
    fields.push('email = ?');
    params.push(String(email).trim().toLowerCase());
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
  if (roleId !== undefined) {
    const role = await adminRolesService.findById(roleId);
    if (!role) {
      const err = new Error('role_id is invalid');
      err.status = 400;
      throw err;
    }
    if (role.status !== 'active') {
      const err = new Error('Cannot assign an inactive role');
      err.status = 400;
      throw err;
    }
    if (role.name === 'super_admin') {
      const err = new Error('Cannot assign the Super Admin role to managed accounts');
      err.status = 400;
      throw err;
    }
    fields.push('role_id = ?');
    params.push(roleId);
  }
  if (!fields.length) {
    const row = await findById(id);
    if (!row) {
      const err = new Error('Admin not found');
      err.status = 404;
      throw err;
    }
    const { password_hash: _, ...rest } = row;
    return normalizeRow(rest);
  }
  params.push(id);
  const result = await execute(
    `UPDATE admin_users SET ${fields.join(', ')} WHERE id = ?`,
    params,
  );
  if (!result?.affectedRows) {
    const err = new Error('Admin not found');
    err.status = 404;
    throw err;
  }
  const row = await findById(id);
  const { password_hash: _, ...rest } = row;
  return normalizeRow(rest);
}

async function resetPassword(id, password) {
  const password_hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const result = await execute(
    'UPDATE admin_users SET password_hash = ? WHERE id = ?',
    [password_hash, id],
  );
  if (!result?.affectedRows) {
    const err = new Error('Admin not found');
    err.status = 404;
    throw err;
  }
  return true;
}

async function deleteAdmin(id) {
  const result = await execute('DELETE FROM admin_users WHERE id = ?', [id]);
  if (!result?.affectedRows) {
    const err = new Error('Admin not found');
    err.status = 404;
    throw err;
  }
  return true;
}

module.exports = {
  listAdmins,
  findById,
  findByLogin,
  verifyPassword,
  touchLastLogin,
  createAdmin,
  updateAdmin,
  resetPassword,
  deleteAdmin,
  normalizeRow,
};
