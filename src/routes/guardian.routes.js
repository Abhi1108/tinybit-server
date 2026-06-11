const express = require('express');
const router = express.Router();
const { requireSupabaseAuth } = require('../middleware/supabaseAuth.middleware');
const {
  inviteParent,
  respondToInvitation,
  getPendingInvitations,
  savePushToken,
  guardianElders,
  guardianAlerts,
  guardianLocation,
  guardianReports,
} = require('../controllers/guardian.controller');

router.post('/invite',               requireSupabaseAuth, inviteParent);
router.post('/respond',              requireSupabaseAuth, respondToInvitation);
router.get('/pending-invitations',   requireSupabaseAuth, getPendingInvitations);
router.post('/save-push-token',      requireSupabaseAuth, savePushToken);

router.get('/elders',                requireSupabaseAuth, guardianElders);
router.get('/alerts',                requireSupabaseAuth, guardianAlerts);
router.get('/location',              requireSupabaseAuth, guardianLocation);
router.get('/reports',               requireSupabaseAuth, guardianReports);

module.exports = router;
