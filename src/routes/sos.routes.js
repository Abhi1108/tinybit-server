const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  triggerSos,
  listEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
} = require('../controllers/sos.controller');

router.post('/trigger', requireJwtAuth, triggerSos);
router.get('/emergency-contacts', requireJwtAuth, listEmergencyContacts);
router.post('/emergency-contacts', requireJwtAuth, createEmergencyContact);
router.patch('/emergency-contacts/:id', requireJwtAuth, updateEmergencyContact);
router.delete('/emergency-contacts/:id', requireJwtAuth, deleteEmergencyContact);

module.exports = router;
