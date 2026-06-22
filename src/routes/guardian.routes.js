const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  inviteParent,
  respondToInvitation,
  getPendingInvitations,
  savePushToken,
  guardianElders,
  guardianAlerts,
  guardianLocation,
  guardianReports,
  getConnectedGuardians,
} = require('../controllers/guardian.controller');

router.post('/invite',               requireJwtAuth, inviteParent);
router.post('/respond',              requireJwtAuth, respondToInvitation);
router.get('/pending-invitations',   requireJwtAuth, getPendingInvitations);
router.get('/connected-guardians',   requireJwtAuth, getConnectedGuardians);
router.post('/save-push-token',      requireJwtAuth, savePushToken);

router.get('/elders',                requireJwtAuth, guardianElders);
router.get('/alerts',                requireJwtAuth, guardianAlerts);
router.get('/location',              requireJwtAuth, guardianLocation);
router.get('/reports',               requireJwtAuth, guardianReports);

module.exports = router;
