const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  getLatestMessage,
  getMessageCount,
  createMessage,
  presignAudioDownload,
} = require('../controllers/family-messages.controller');

router.get('/latest', requireJwtAuth, getLatestMessage);
router.get('/count', requireJwtAuth, getMessageCount);
router.post('/', requireJwtAuth, createMessage);
router.post('/presign-download', requireJwtAuth, presignAudioDownload);

module.exports = router;
