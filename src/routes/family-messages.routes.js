const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  getLatestMessage,
  getMessageCount,
  createMessage,
} = require('../controllers/family-messages.controller');

router.get('/latest', requireJwtAuth, getLatestMessage);
router.get('/count', requireJwtAuth, getMessageCount);
router.post('/', requireJwtAuth, createMessage);

module.exports = router;
