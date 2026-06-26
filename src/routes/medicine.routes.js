const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listMedicines,
  getMedicine,
  createMedicines,
  updateMedicine,
  deleteMedicine,
} = require('../controllers/medicine.controller');

router.get('/', requireJwtAuth, listMedicines);
router.get('/:id', requireJwtAuth, getMedicine);
router.post('/', requireJwtAuth, createMedicines);
router.patch('/:id', requireJwtAuth, updateMedicine);
router.delete('/:id', requireJwtAuth, deleteMedicine);

module.exports = router;
