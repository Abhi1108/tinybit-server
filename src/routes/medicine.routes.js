const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listMedicines,
  getMedicine,
  createMedicines,
  updateMedicine,
  listMedicineLogs,
  toggleMedicineLog,
} = require('../controllers/medicine.controller');

router.get('/logs', requireJwtAuth, listMedicineLogs);
router.post('/logs/toggle', requireJwtAuth, toggleMedicineLog);
router.get('/', requireJwtAuth, listMedicines);
router.get('/:id', requireJwtAuth, getMedicine);
router.post('/', requireJwtAuth, createMedicines);
router.patch('/:id', requireJwtAuth, updateMedicine);

module.exports = router;
