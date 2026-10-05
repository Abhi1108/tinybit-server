const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { requireFeature } = require('../middleware/planEntitlement.middleware');
const { getTodayCheckIn, upsertDailyCheckIn, insertHealthMetrics, getHealthMetrics } = require('../controllers/wellness.controller');

router.get('/daily-checkin/today', requireJwtAuth, requireFeature('daily_checkin'), getTodayCheckIn);
router.post('/daily-checkin', requireJwtAuth, requireFeature('daily_checkin'), upsertDailyCheckIn);
router.get('/health-metrics', requireJwtAuth, getHealthMetrics);
router.post('/health-metrics', requireJwtAuth, insertHealthMetrics);

module.exports = router;
