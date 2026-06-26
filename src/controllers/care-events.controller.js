const careEventsService = require('../services/care-events.service');

function isTableMissing(error) {
  return (
    error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

/** GET /api/care-events */
async function listCareEvents(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const careEvents = await careEventsService.listByUser(userId);
    return res.json({ success: true, careEvents });
  } catch (err) {
    console.error('[care-events] list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'care_events table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load care events.',
    });
  }
}

module.exports = {
  listCareEvents,
};
