const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  getTodaysQuiz,
  getTodaysInspiration,
} = require('../controllers/content.controller');

router.get('/quiz/today', requireJwtAuth, getTodaysQuiz);
router.get('/inspiration/today', requireJwtAuth, getTodaysInspiration);

module.exports = router;
