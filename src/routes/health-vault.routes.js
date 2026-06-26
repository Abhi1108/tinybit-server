const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listRecords,
  createRecord,
  deleteRecord,
} = require('../controllers/health-vault.controller');

router.get('/records', requireJwtAuth, listRecords);
router.post('/records', requireJwtAuth, createRecord);
router.delete('/records/:id', requireJwtAuth, deleteRecord);

module.exports = router;
