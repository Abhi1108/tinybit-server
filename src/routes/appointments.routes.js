const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  listAppointments,
  createAppointment,
  updateAppointmentStatus,
} = require('../controllers/appointments.controller');

router.get('/', requireJwtAuth, listAppointments);
router.post('/', requireJwtAuth, createAppointment);
router.patch('/:id', requireJwtAuth, updateAppointmentStatus);

module.exports = router;
