const express = require('express');
const router = express.Router();
const { listDoctors, getDoctor } = require('../controllers/doctors.controller');

router.get('/', listDoctors);
router.get('/:id', getDoctor);

module.exports = router;
