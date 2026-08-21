const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  getInsights,
  compareRecords,
  listDoctors,
  createDoctor,
  deleteDoctor,
} = require('../controllers/health-vault.controller');

router.get('/records', requireJwtAuth, listRecords);
router.post('/records', requireJwtAuth, createRecord);
router.patch('/records/:id', requireJwtAuth, updateRecord);
router.delete('/records/:id', requireJwtAuth, deleteRecord);
router.post('/records/:id/insights', requireJwtAuth, getInsights);

router.post('/compare', requireJwtAuth, compareRecords);

router.get('/doctors', requireJwtAuth, listDoctors);
router.post('/doctors', requireJwtAuth, createDoctor);
router.delete('/doctors/:id', requireJwtAuth, deleteDoctor);

module.exports = router;
