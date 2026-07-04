const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listMedicines,
  getMedicine,
  createMedicines,
  updateMedicine,
  deleteMedicine,
  listMedicineLogs,
  toggleMedicineLog,
} = require('../controllers/medicine.controller');

router.get('/logs', requireJwtAuth, listMedicineLogs);
router.post('/logs/toggle', requireJwtAuth, toggleMedicineLog);
router.get('/', requireJwtAuth, listMedicines);
router.get('/:id', requireJwtAuth, getMedicine);
router.post('/', requireJwtAuth, createMedicines);
router.patch('/:id', requireJwtAuth, updateMedicine);
router.delete('/:id', requireJwtAuth, deleteMedicine);

module.exports = router;
