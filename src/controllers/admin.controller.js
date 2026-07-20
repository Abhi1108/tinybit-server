const path = require('path');
const { toE164, phoneToAuthEmail } = require('../utils/phone');
const {
  createUserWithPassword,
  findAppUserById,
  findByPhone,
  findOrCreateByPhone,
} = require('../services/auth-users.service');
const adminService = require('../services/admin.service');
const auditService = require('../services/admin-audit.mysql');
const adminUsersService = require('../services/admin-users.mysql');
const adminRolesService = require('../services/admin-roles.mysql');
const { signAdminToken, checkSession } = require('../services/admin-jwt');
const { purgeUserById } = require('../services/user-purge.service');

function publicAdminUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    role_id: user.role_id ?? null,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
  };
}

const PROFILE_PATCH_FIELDS = [
  'full_name', 'first_name', 'last_name', 'email', 'mobile', 'role',
  'country', 'country_code', 'age', 'biological_sex', 'location',
  'preferred_language', 'blood_group', 'medical_conditions',
  'emergency_phone', 'emergency_name', 'emergency_relation',
  'plan_type', 'plan_status', 'is_banned',
];

// ── Auth ────────────────────────────────────────────────────────────────────

const login = async (req, res) => {
  const { username, password } = req.body ?? {};
  const loginId = String(username ?? '').trim();
  const pass = String(password ?? '');

  if (!loginId || !pass) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  const envUser = process.env.ADMIN_USERNAME ?? 'admin';
  const envPass = process.env.ADMIN_PASSWORD ?? 'tinybit2025';

  // Super Admin — shared env credentials (never stored in admin_users).
  if (loginId === envUser && pass === envPass) {
    const permissions = ['*'];
    const token = signAdminToken({
      id: 'env-super-admin',
      username: envUser,
      role: 'super_admin',
      roleId: adminRolesService.SYSTEM_SUPER_ADMIN_ID,
      name: 'Super Admin',
      permissions,
    });
    void auditService.recordSafe({
      actor: envUser,
      action: 'auth.login',
      targetType: 'auth',
      details: { username: envUser, role: 'super_admin' },
      ip: req.ip,
    });
    return res.json({
      success: true,
      token,
      user: publicAdminUser({
        id: 'env-super-admin',
        username: envUser,
        name: 'Super Admin',
        email: envUser,
        role: 'super_admin',
        role_id: adminRolesService.SYSTEM_SUPER_ADMIN_ID,
        permissions,
      }),
    });
  }

  try {
    const row = await adminUsersService.findByLogin(loginId);
    if (!row || !(await adminUsersService.verifyPassword(row, pass))) {
      void auditService.recordSafe({
        actor: loginId || 'unknown',
        action: 'auth.login_failed',
        targetType: 'auth',
        details: { username: loginId },
        ip: req.ip,
      });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (row.status !== 'active') {
      void auditService.recordSafe({
        actor: row.username,
        action: 'auth.login_failed',
        targetType: 'auth',
        details: { username: row.username, reason: 'inactive' },
        ip: req.ip,
      });
      return res.status(403).json({ success: false, error: 'Account is inactive' });
    }

    const permissions = adminRolesService.parsePermissions(row.role_permissions);
    if (!row.role_name || row.role_status !== 'active') {
      return res.status(403).json({ success: false, error: 'Assigned role is inactive or missing' });
    }

    await adminUsersService.touchLastLogin(row.id);
    const token = signAdminToken({
      id: row.id,
      username: row.username,
      role: row.role_name,
      roleId: row.role_id,
      name: row.name,
      permissions,
    });
    void auditService.recordSafe({
      actor: row.username,
      action: 'auth.login',
      targetType: 'auth',
      details: { username: row.username, role: row.role_name },
      ip: req.ip,
    });
    return res.json({
      success: true,
      token,
      user: publicAdminUser({
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email,
        role: row.role_name,
        role_id: row.role_id,
        permissions,
      }),
    });
  } catch (err) {
    console.error('[admin.login]', err);
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
};

const logout = (_req, res) => {
  return res.json({ success: true });
};

// ── Managed admin accounts (super_admin only) ───────────────────────────────

const listAdminAccounts = async (req, res) => {
  try {
    const admins = await adminUsersService.listAdmins({
      search: req.query.search,
      status: req.query.status,
    });
    return res.json({ success: true, admins });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const createAdminAccount = async (req, res) => {
  try {
    const { username, email, name, password, role_id: roleId } = req.body ?? {};
    if (!username?.trim() || !email?.trim() || !name?.trim() || !password || !roleId) {
      return res.status(400).json({
        success: false,
        error: 'username, email, name, password, and role_id are required',
      });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const envUser = process.env.ADMIN_USERNAME ?? 'admin';
    if (String(username).trim() === envUser) {
      return res.status(409).json({
        success: false,
        error: 'Username is reserved for the Super Admin shared credential',
      });
    }

    const admin = await adminUsersService.createAdmin({
      username,
      email,
      name,
      password,
      roleId,
      createdBy: req.admin?.username ?? 'unknown',
    });
    void auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'admin.create',
      targetType: 'admin_user',
      targetId: admin.id,
      details: { username: admin.username, email: admin.email, role_id: roleId },
      ip: req.ip,
    });
    return res.status(201).json({ success: true, admin });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Username or email already exists' });
    }
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const updateAdminAccount = async (req, res) => {
  try {
    const admin = await adminUsersService.updateAdmin(req.params.id, {
      name: req.body?.name,
      email: req.body?.email,
      status: req.body?.status,
      roleId: req.body?.role_id,
    });
    void auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'admin.update',
      targetType: 'admin_user',
      targetId: admin.id,
      details: { username: admin.username, status: admin.status, role_id: admin.role_id },
      ip: req.ip,
    });
    return res.json({ success: true, admin });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Email already exists' });
    }
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const resetAdminPassword = async (req, res) => {
  try {
    const { password } = req.body ?? {};
    if (!password || String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    await adminUsersService.resetPassword(req.params.id, password);
    void auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'admin.password_reset',
      targetType: 'admin_user',
      targetId: req.params.id,
      ip: req.ip,
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const deleteAdminAccount = async (req, res) => {
  try {
    const existing = await adminUsersService.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    await adminUsersService.deleteAdmin(req.params.id);
    void auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'admin.delete',
      targetType: 'admin_user',
      targetId: req.params.id,
      details: { username: existing.username },
      ip: req.ip,
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ── Roles ───────────────────────────────────────────────────────────────────

const listRoles = async (_req, res) => {
  try {
    const roles = await adminRolesService.listRoles();
    return res.json({
      success: true,
      roles,
      permission_catalog: adminRolesService.PERMISSION_CATALOG,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const createRole = async (req, res) => {
  try {
    const role = await adminRolesService.createRole({
      label: req.body?.label,
      description: req.body?.description,
      permissions: req.body?.permissions,
      status: req.body?.status,
    });
    void auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'role.create',
      targetType: 'admin_role',
      targetId: role.id,
      details: { name: role.name, label: role.label },
      ip: req.ip,
    });
    return res.status(201).json({ success: true, role });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Role name already exists' });
    }
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const updateRole = async (req, res) => {
  try {
    const role = await adminRolesService.updateRole(req.params.id, {
      label: req.body?.label,
      description: req.body?.description,
      permissions: req.body?.permissions,
      status: req.body?.status,
    });
    void auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'role.update',
      targetType: 'admin_role',
      targetId: role.id,
      details: { name: role.name, label: role.label },
      ip: req.ip,
    });
    return res.json({ success: true, role });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const deleteRole = async (req, res) => {
  try {
    const existing = await adminRolesService.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Role not found' });
    }
    await adminRolesService.deleteRole(req.params.id);
    void auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'role.delete',
      targetType: 'admin_role',
      targetId: req.params.id,
      details: { name: existing.name },
      ip: req.ip,
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ── Dashboard ───────────────────────────────────────────────────────────────

const getStats = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return res.json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const analytics = await adminService.getAnalytics();
    return res.json(analytics);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ── Users ───────────────────────────────────────────────────────────────────

const getUsers = async (req, res) => {
  const { role, search, status, page = '1', limit = '20', deleted } = req.query;

  try {
    const result = await adminService.getUsers({ role, search, status, page, limit, deleted });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const getIncompleteUsers = async (req, res) => {
  const { page = '1', limit = '20' } = req.query;

  try {
    const result = await adminService.getIncompleteUsers({ page, limit });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const exportUsers = async (req, res) => {
  const { role, status } = req.query;

  try {
    const rows = await adminService.exportUsers({ role, status });
    const header = ['id', 'full_name', 'email', 'mobile', 'role', 'country', 'age', 'is_banned', 'created_at', 'last_active'];
    const escape = (v) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(','),
      ...rows.map((r) => header.map((k) => escape(r[k])).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tinybit-users-${role || 'all'}.csv"`);
    return res.send(lines.join('\n'));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const [profile, appUser, linksAsGuardian, linksAsElder] = await Promise.all([
      adminService.getProfileById(id),
      findAppUserById(id),
      adminService.getGuardianLinksByGuardianId(id),
      adminService.getGuardianLinksByElderId(id),
    ]);

    if (!profile && !appUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const linkIds = [
      ...linksAsGuardian.map((l) => l.elder_id).filter(Boolean),
      ...linksAsElder.map((l) => l.guardian_id),
    ];
    const userMap = await adminService.fetchUserMap([...new Set(linkIds)]);

    const enrichLink = (link) => ({
      ...link,
      guardian_name: userMap[link.guardian_id]?.full_name ?? '—',
      guardian_email: userMap[link.guardian_id]?.email ?? '—',
      elder_name: link.elder_id ? (userMap[link.elder_id]?.full_name ?? '—') : '—',
    });

    return res.json({
      success: true,
      profile,
      app_user: appUser,
      connections: {
        as_guardian: linksAsGuardian.map(enrichLink),
        as_elder: linksAsElder.map(enrichLink),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const createUser = async (req, res) => {
  const {
    phone,
    countryCode = '+91',
    fullName,
    password,
    role = 'elder',
    email: explicitEmail,
    ...rest
  } = req.body ?? {};

  if (!phone) {
    return res.status(400).json({ success: false, error: 'phone is required' });
  }
  if (!['elder', 'guardian', 'caregiver'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }

  try {
    const phoneE164 = toE164(phone, countryCode);
    const authEmail = explicitEmail || phoneToAuthEmail(phone, countryCode);

    let appUser;
    if (password) {
      appUser = await createUserWithPassword({ phoneE164, email: authEmail, password });
    } else {
      const existing = await findByPhone(phoneE164);
      if (existing) {
        return res.status(409).json({ success: false, error: 'User with this phone already exists' });
      }
      const created = await findOrCreateByPhone(phoneE164, authEmail);
      appUser = created.user;
    }

    const profilePayload = {
      id: appUser.id,
      full_name: fullName || null,
      email: explicitEmail || authEmail,
      mobile: phoneE164,
      role,
      plan_type: 'free',
      plan_status: 'active',
      plan_currency: 'INR',
      streak: 0,
      is_banned: false,
    };

    PROFILE_PATCH_FIELDS.forEach((key) => {
      if (rest[key] !== undefined) profilePayload[key] = rest[key];
    });

    const profile = await adminService.upsertProfile(profilePayload);
    await auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'user.create',
      targetType: 'user',
      targetId: appUser.id,
      details: { role, phone: phoneE164 },
      ip: req.ip,
    });
    return res.status(201).json({ success: true, profile, app_user: appUser });
  } catch (err) {
    if (err.code === 'USER_EXISTS') {
      return res.status(409).json({ success: false, error: 'User already exists' });
    }
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const body = req.body ?? {};
  const patch = {};

  PROFILE_PATCH_FIELDS.forEach((key) => {
    if (body[key] !== undefined) patch[key] = body[key];
  });

  if (!Object.keys(patch).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    const profile = await adminService.updateProfile(id, patch);
    await auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      details: { fields: Object.keys(patch) },
      ip: req.ip,
    });
    return res.json({ success: true, profile });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const banUser = async (req, res) => {
  const { id } = req.params;
  const { banned } = req.body;
  try {
    await adminService.updateProfile(id, { is_banned: !!banned });
    await auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: banned ? 'user.ban' : 'user.unban',
      targetType: 'user',
      targetId: id,
      ip: req.ip,
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message ?? 'Update failed. Run migration 054 to add the is_banned column.',
    });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;
  const actor = req.admin?.username ?? 'unknown';
  try {
    await adminService.softDeleteProfile(id, actor);
    await auditService.recordSafe({ actor, action: 'user.trash', targetType: 'user', targetId: id, ip: req.ip });
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const restoreUser = async (req, res) => {
  const { id } = req.params;
  const actor = req.admin?.username ?? 'unknown';
  try {
    await adminService.restoreProfile(id);
    await auditService.recordSafe({ actor, action: 'user.restore', targetType: 'user', targetId: id, ip: req.ip });
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const purgeUser = async (req, res) => {
  const { id } = req.params;
  const actor = req.admin?.username ?? 'unknown';
  try {
    const trashed = await adminService.getDeletedProfile(id);
    if (!trashed) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (!trashed.deleted_at) {
      return res.status(409).json({ success: false, error: 'User must be moved to trash before it can be purged' });
    }

    const result = await purgeUserById(id, actor, req.ip);
    return res.json({ success: true, deletedObjectCount: result.deletedObjectCount, s3Failures: result.s3Failures });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ── Connections ─────────────────────────────────────────────────────────────

const getConnections = async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;

  try {
    const result = await adminService.getConnections({ status, page, limit, search });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const updateConnection = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!['connected', 'declined', 'pending'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  try {
    const connection = await adminService.updateConnection(id, status);
    return res.json({ success: true, connection });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const deleteConnection = async (req, res) => {
  const { id } = req.params;
  try {
    await adminService.deleteConnection(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Medicines ────────────────────────────────────────────────────────────────

const getMedicines = async (req, res) => {
  const { page = 1, limit = 20, category, priority, active } = req.query;

  try {
    const medicines = await adminService.getMedicines({ page, limit, category, priority, active });
    return res.json({ success: true, medicines });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Daily Check-ins ──────────────────────────────────────────────────────────

const getCheckIns = async (req, res) => {
  const { page = 1, limit = 20, mood } = req.query;

  try {
    const check_ins = await adminService.getCheckIns({ page, limit, mood });
    return res.json({ success: true, check_ins });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Moods ────────────────────────────────────────────────────────────────────

const getMoods = async (req, res) => {
  const { page = 1, limit = 20, mood } = req.query;

  try {
    const moods = await adminService.getMoods({ page, limit, mood });
    return res.json({ success: true, moods });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── AI Conversations ─────────────────────────────────────────────────────────

const getAIConversations = async (req, res) => {
  const { page = 1, limit = 20, role } = req.query;

  try {
    const conversations = await adminService.getAIConversations({ page, limit, role });
    return res.json({ success: true, conversations });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Care Events ───────────────────────────────────────────────────────────────

const getCareEvents = async (req, res) => {
  const { page = 1, limit = 20, type, user_id } = req.query;

  try {
    const events = await adminService.getCareEvents({ page, limit, type, user_id });
    return res.json({ success: true, events });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const createCareEvent = async (req, res) => {
  const { user_id, title, sub, time, type, color, emoji, date, month, year, timestamp } = req.body ?? {};
  if (!user_id || !title) {
    return res.status(400).json({ success: false, error: 'user_id and title are required' });
  }
  const careEventsService = require('../services/care-events.service');
  try {
    const careEvent = await careEventsService.create(user_id, {
      title, sub, time, type, color, emoji, date, month, year, timestamp
    });
    
    // Automatically trigger notification for the newly created event!
    const { query, execute } = require('../config/mysql');
    const { randomUUID } = require('crypto');
    
    const [elder] = await query('SELECT full_name FROM profiles WHERE id = ? LIMIT 1', [user_id]);
    const elderName = elder?.full_name || 'Elder';
    
    const notifTitle = `New Event Scheduled: ${title}`;
    const notifBody = `A new care event "${title}" is scheduled for ${elderName} on ${month} ${date}, ${year} at ${time}.`;
    
    const createNotif = async (targetId) => {
      const notifId = randomUUID();
      const dataJson = JSON.stringify({ source: 'calendar_event_created', event_id: careEvent.id });
      await execute(
        `INSERT INTO notifications (id, user_id, sender_id, type, title, body, data, \`read\`)
         VALUES (?, ?, NULL, 'calendar_alert', ?, ?, ?, 0)`,
        [notifId, targetId, notifTitle, notifBody, dataJson],
      );
    };

    // Notify Elder
    await createNotif(user_id);

    // Notify Guardians
    const guardians = await query(
      `SELECT guardian_id FROM guardian_elder_links WHERE elder_id = ? AND status = 'connected'`,
      [user_id]
    );
    for (const g of guardians) {
      await createNotif(g.guardian_id);
    }

    return res.status(201).json({ success: true, careEvent });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const deleteCareEvent = async (req, res) => {
  const { id } = req.params;
  const careEventsService = require('../services/care-events.service');
  const { query } = require('../config/mysql');
  try {
    const [event] = await query('SELECT user_id, title FROM care_events WHERE id = ? LIMIT 1', [id]);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    const result = await careEventsService.deleteEvent(event.user_id, id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    
    // Automatically trigger notification for deleted event!
    const { execute } = require('../config/mysql');
    const { randomUUID } = require('crypto');
    
    const [elder] = await query('SELECT full_name FROM profiles WHERE id = ? LIMIT 1', [event.user_id]);
    const elderName = elder?.full_name || 'Elder';
    
    const notifTitle = `Event Cancelled: ${event.title}`;
    const notifBody = `The care event "${event.title}" scheduled for ${elderName} has been cancelled.`;
    
    const createNotif = async (targetId) => {
      const notifId = randomUUID();
      const dataJson = JSON.stringify({ source: 'calendar_event_deleted' });
      await execute(
        `INSERT INTO notifications (id, user_id, sender_id, type, title, body, data, \`read\`)
         VALUES (?, ?, NULL, 'calendar_alert', ?, ?, ?, 0)`,
        [notifId, targetId, notifTitle, notifBody, dataJson],
      );
    };

    // Notify Elder
    await createNotif(event.user_id);

    // Notify Guardians
    const guardians = await query(
      `SELECT guardian_id FROM guardian_elder_links WHERE elder_id = ? AND status = 'connected'`,
      [event.user_id]
    );
    for (const g of guardians) {
      await createNotif(g.guardian_id);
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Mind Games ────────────────────────────────────────────────────────────────

const getMindGames = async (req, res) => {
  const { page = 1, limit = 20, game_type } = req.query;

  try {
    const scores = await adminService.getMindGames({ page, limit, game_type });
    return res.json({ success: true, scores });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getSosAlerts = async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  try {
    const alerts = await adminService.getSosAlerts({ page, limit, status });
    return res.json({ success: true, alerts });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getNotifications = async (req, res) => {
  const { page = 1, limit = 50, type, search } = req.query;
  try {
    const notifications = await adminService.getNotifications({ page, limit, type, search });
    return res.json({ success: true, notifications });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Broadcast Notification ────────────────────────────────────────────────────

const broadcast = async (req, res) => {
  const { title, body } = req.body ?? {};
  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title and body are required' });
  }

  try {
    const sent = await adminService.broadcastNotification(title, body);
    await auditService.recordSafe({
      actor: req.admin?.username ?? 'unknown',
      action: 'notification.broadcast',
      targetType: 'notification',
      details: { title, sent },
      ip: req.ip,
    });
    return res.json({ success: true, sent });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getHealthRecords = async (req, res) => {
  const { page = 1, limit = 20, category, user_id, search } = req.query;
  try {
    const result = await adminService.getHealthRecords({ page, limit, category, user_id, search });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getEmergencyContacts = async (req, res) => {
  const { page = 1, limit = 50, search } = req.query;
  try {
    const contacts = await adminService.getEmergencyContacts({ page, limit, search });
    return res.json({ success: true, contacts });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getJournalEntries = async (req, res) => {
  const { page = 1, limit = 50, type, search } = req.query;
  try {
    const entries = await adminService.getJournalEntries({ page, limit, type, search });
    return res.json({ success: true, entries });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getFamilyMessages = async (req, res) => {
  const { page = 1, limit = 50, search } = req.query;
  try {
    const messages = await adminService.getFamilyMessages({ page, limit, search });
    return res.json({ success: true, messages });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getElderLocations = async (req, res) => {
  const { page = 1, limit = 100, sharing } = req.query;
  try {
    const locations = await adminService.getElderLocations({ page, limit, sharing });
    return res.json({ success: true, locations });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getAppointments = async (req, res) => {
  const { page = 1, limit = 50, status, search } = req.query;
  try {
    const appointments = await adminService.getAppointments({ page, limit, status, search });
    return res.json({ success: true, appointments });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getStreaks = async (req, res) => {
  const { page = 1, limit = 50, search } = req.query;
  try {
    const streaks = await adminService.getStreaks({ page, limit, search });
    return res.json({ success: true, streaks });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getUserSubscriptions = async (req, res) => {
  const { page = 1, limit = 50, status, search } = req.query;
  try {
    const subscriptions = await adminService.getUserSubscriptions({ page, limit, status, search });
    return res.json({ success: true, subscriptions });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getRevenueSummary = async (req, res) => {
  try {
    const summary = await adminService.getRevenueSummary();
    return res.json({ success: true, summary });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const deleteHealthRecord = async (req, res) => {
  const { id } = req.params;
  const healthRecordsService = require('../services/health-records.service');
  const { query } = require('../config/mysql');
  try {
    const [rec] = await query('SELECT user_id FROM health_records WHERE id = ? LIMIT 1', [id]);
    if (!rec) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    const result = await healthRecordsService.deleteById(rec.user_id, id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Audit log ────────────────────────────────────────────────────────────────

const getAuditLogs = async (req, res) => {
  const { page = '1', limit = '50', action, search } = req.query;
  try {
    const result = await auditService.list({ page, limit, action, search });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const exportAuditLogs = async (req, res) => {
  try {
    const rows = await auditService.listAll();
    const header = ['created_at', 'actor', 'action', 'target_type', 'target_id', 'ip', 'details'];
    const escape = (v) => {
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(','),
      ...rows.map((r) => header.map((k) => escape(r[k])).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tinybit-audit-log.csv"');
    return res.send(lines.join('\n'));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ── Serve dashboard ───────────────────────────────────────────────────────────

const serveDashboard = (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin/index.html'));
};

module.exports = {
  checkSession, // re-export from admin-jwt for any legacy imports
  login, logout,
  listAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  resetAdminPassword,
  deleteAdminAccount,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  serveDashboard,
  getStats, getAnalytics,
  getUsers, getIncompleteUsers, exportUsers, getUserById, createUser, updateUser,
  banUser, deleteUser, restoreUser, purgeUser,
  getConnections, updateConnection, deleteConnection,
  getMedicines,
  getCheckIns,
  getMoods,
  getAIConversations,
  getCareEvents,
  createCareEvent,
  deleteCareEvent,
  getMindGames,
  getSosAlerts,
  getNotifications,
  broadcast,
  getHealthRecords,
  deleteHealthRecord,
  getEmergencyContacts,
  getJournalEntries,
  getFamilyMessages,
  getElderLocations,
  getAppointments,
  getStreaks,
  getUserSubscriptions,
  getRevenueSummary,
  getAuditLogs,
  exportAuditLogs,
};
