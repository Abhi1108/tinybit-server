/** @deprecated Use jwtAuth.middleware.js — kept for import compatibility. */
const { requireJwtAuth } = require('./jwtAuth.middleware');

module.exports = {
  requireSupabaseAuth: requireJwtAuth,
  requireJwtAuth,
};
