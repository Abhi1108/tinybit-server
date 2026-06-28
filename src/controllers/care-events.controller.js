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
    return res.json({ success: true, careEvents, events: careEvents });
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

/** POST /api/care-events */
async function createCareEvent(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = req.body || {};
    if (!body.title?.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }

    const careEvent = await careEventsService.create(userId, body);
    return res.json({ success: true, careEvent });
  } catch (err) {
    console.error('[care-events] create', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'care_events table is not deployed.' });
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Could not create care event.',
    });
  }
}

/** PATCH /api/care-events/:id */
async function updateCareEvent(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params;
    const careEvent = await careEventsService.update(userId, id, req.body || {});
    if (!careEvent) {
      return res.status(404).json({ success: false, message: 'Care event not found.' });
    }

    return res.json({ success: true, careEvent });
  } catch (err) {
    console.error('[care-events] update', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'care_events table is not deployed.' });
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Could not update care event.',
    });
  }
}

/** DELETE /api/care-events/:id */
async function deleteCareEvent(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params;
    const success = await careEventsService.deleteEvent(userId, id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Care event not found.' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[care-events] delete', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'care_events table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not delete care event.',
    });
  }
}

module.exports = {
  listCareEvents,
  createCareEvent,
  updateCareEvent,
  deleteCareEvent,
};
