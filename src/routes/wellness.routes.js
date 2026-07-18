const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { getTodayCheckIn, upsertDailyCheckIn, insertHealthMetrics, getHealthMetrics } = require('../controllers/wellness.controller');

router.get('/daily-checkin/today', requireJwtAuth, getTodayCheckIn);
router.post('/daily-checkin', requireJwtAuth, upsertDailyCheckIn);
router.get('/health-metrics', requireJwtAuth, getHealthMetrics);
router.post('/health-metrics', requireJwtAuth, insertHealthMetrics);

module.exports = router;
