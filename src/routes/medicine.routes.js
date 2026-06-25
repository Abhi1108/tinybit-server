const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listMedicines,
  getMedicine,
  createMedicines,
  updateMedicine,
} = require('../controllers/medicine.controller');

router.get('/', requireJwtAuth, listMedicines);
router.get('/:id', requireJwtAuth, getMedicine);
router.post('/', requireJwtAuth, createMedicines);
router.patch('/:id', requireJwtAuth, updateMedicine);

module.exports = router;
