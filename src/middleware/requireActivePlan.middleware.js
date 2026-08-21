const profilesService = require('../services/profiles.service');

/**
 * Gates every /api/guardian/* route (CONTEXT.md Q6 — no free trial). Only role='guardian'
 * profiles are checked; elders never see or care about their guardian's payment status,
 * so a non-guardian caller passes through untouched. Must run after requireJwtAuth
 * (needs req.auth.userId).
 */
async function requireActivePlan(req, res, next) {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const profile = await profilesService.getProfileById(userId);

    // No profiles row yet: guardian.controller.js#ensureGuardianProfile lazily creates one
    // on /invite for clients that reach it before onboarding's normal profile upsert. That
    // guardian is definitionally unpaid, so gate the same as an expired plan — not a 404,
    // which would misleadingly suggest a different fix than "complete payment".
    if (!profile) {
      return res.status(402).json({
        success: false,
        message: 'Please complete payment to continue.',
        code: 'PLAN_EXPIRED',
      });
    }

    if (profile.role !== 'guardian') {
      return next();
    }

    const expiresAt = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null;
    const isActive = ['active', 'trial'].includes(profile.plan_status) && expiresAt && expiresAt.getTime() > Date.now();

    if (!isActive) {
      return res.status(402).json({
        success: false,
        message: 'Your plan is inactive or has expired. Please complete payment to continue.',
        code: 'PLAN_EXPIRED',
      });
    }

    return next();
  } catch (err) {
    console.error('[requireActivePlan]', err);
    return res.status(500).json({ success: false, message: 'Could not verify plan status.' });
  }
}

module.exports = { requireActivePlan };
