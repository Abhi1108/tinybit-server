const { checkSession } = require('../services/admin-jwt');
const adminRolesService = require('../services/admin-roles.mysql');

function sessionAuth(req, res, next) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const payload = checkSession(auth.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.admin = payload;
  return next();
}

function requireSuperAdmin(req, res, next) {
  const perms = Array.isArray(req.admin?.permissions) ? req.admin.permissions : [];
  const isSuper =
    req.admin?.role === 'super_admin'
    || perms.includes('*')
    || perms.includes('All Modules');
  if (!isSuper) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  return next();
}

/** Require any of the listed permission keys (OR). */
function requirePermission(...keys) {
  return (req, res, next) => {
    const perms = Array.isArray(req.admin?.permissions) ? req.admin.permissions : [];
    if (adminRolesService.hasPermission(perms, ...keys)) {
      return next();
    }
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

module.exports = {
  sessionAuth,
  requireSuperAdmin,
  requirePermission,
};
