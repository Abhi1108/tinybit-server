const notificationsService = require('../services/notifications.service');

// GET /api/notifications?limit=20&offset=0
const getNotifications = async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const data = await notificationsService.listNotifications(userId, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getNotifications error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// POST /api/notifications/:id/read
const markNotificationRead = async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const found = await notificationsService.markNotificationRead(req.params.id, userId);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('markNotificationRead error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { getNotifications, markNotificationRead };
