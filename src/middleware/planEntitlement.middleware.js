const profilesService = require('../services/profiles.service');
const { isProfilePremium } = require('../services/plan-entitlements.service');

const FEATURE_NAMES = {
  location_tracking: 'Location Tracking',
  health_forecasting: 'Health Forecasting',
  daily_checkin: 'Daily Check-in',
  voice_messages: 'Voice Messaging',
  activity_log: 'Activity Log',
  report_analytics: 'Report Analytics',
};

/**
 * Middleware to gate premium-only features for guardians.
 * Elders never require a plan and pass through.
 *
 * @param {string} featureKey One of the keys from FEATURE_NAMES
 */
function requireFeature(featureKey) {
  return async function (req, res, next) {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
      const profile = await profilesService.getProfileById(userId);
      if (!profile || profile.role !== 'guardian') {
        return next();
      }

      const isPremium = isProfilePremium(profile);
      if (!isPremium) {
        const featureLabel = FEATURE_NAMES[featureKey] || featureKey.replace(/_/g, ' ');
        return res.status(403).json({
          success: false,
          code: 'FEATURE_LOCKED',
          feature: featureKey,
          message: `${featureLabel} requires a TinyBit Premium subscription.`,
        });
      }

      req.profile = profile;
      return next();
    } catch (err) {
      console.error(`[requireFeature:${featureKey}]`, err);
      return res.status(500).json({ success: false, message: 'Could not verify subscription entitlements.' });
    }
  };
}

module.exports = {
  requireFeature,
  FEATURE_NAMES,
};
