const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { presignUpload, presignDownload } = require('../controllers/storage.controller');

router.post('/presign-upload', requireJwtAuth, presignUpload);
router.post('/presign-download', requireJwtAuth, presignDownload);

module.exports = router;
