const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { getNotifications, markNotificationRead } = require('../controllers/notifications.controller');

// Every user (elder or guardian) has their own inbox — no requireActivePlan gate, unlike the
// guardian-only paywalled routes.
router.get('/', requireJwtAuth, getNotifications);
router.post('/:id/read', requireJwtAuth, markNotificationRead);

module.exports = router;
