const streakService = require('../services/streak.service');

function isTableMissing(error) {
  return (
    error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

/** GET /api/streak/summary */
async function getSummary(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const summary = await streakService.getStreakSummary(userId);
    return res.json({ success: true, data: summary });
  } catch (err) {
    console.error('[streak] getSummary', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'streak_activity_log table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load streak summary.',
    });
  }
}

module.exports = { getSummary };
