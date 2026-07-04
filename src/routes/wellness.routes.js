const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { getTodayCheckIn, upsertDailyCheckIn, insertHealthMetrics, getHealthMetrics, getYesterdaySummary } = require('../controllers/wellness.controller');

router.get('/daily-checkin/today', requireJwtAuth, getTodayCheckIn);
router.post('/daily-checkin', requireJwtAuth, upsertDailyCheckIn);
router.get('/health-metrics', requireJwtAuth, getHealthMetrics);
router.post('/health-metrics', requireJwtAuth, insertHealthMetrics);
router.get('/yesterday-summary', requireJwtAuth, getYesterdaySummary);

module.exports = router;
