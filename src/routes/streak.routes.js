const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { getSummary } = require('../controllers/streak.controller');

router.get('/summary', requireJwtAuth, getSummary);

module.exports = router;
