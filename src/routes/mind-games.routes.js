const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  postScore,
  getStats,
  getLeaderboard,
} = require('../controllers/mind-games.controller');

router.post('/scores', requireJwtAuth, postScore);
router.get('/stats', requireJwtAuth, getStats);
router.get('/leaderboard', requireJwtAuth, getLeaderboard);

module.exports = router;
