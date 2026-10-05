const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { requireFeature } = require('../middleware/planEntitlement.middleware');
const {
  getMessageHistory,
  getLatestMessage,
  getMessageCount,
  createMessage,
  presignAudioDownload,
} = require('../controllers/family-messages.controller');

router.get('/history', requireJwtAuth, getMessageHistory);
router.get('/latest', requireJwtAuth, getLatestMessage);
router.get('/count', requireJwtAuth, getMessageCount);
router.post('/', requireJwtAuth, requireFeature('voice_messages'), createMessage);
router.post('/presign-download', requireJwtAuth, presignAudioDownload);

module.exports = router;
