const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listJournalEntries,
  getJournalCount,
  createJournalEntry,
} = require('../controllers/journal.controller');

router.get('/count', requireJwtAuth, getJournalCount);
router.get('/', requireJwtAuth, listJournalEntries);
router.post('/', requireJwtAuth, createJournalEntry);

module.exports = router;
