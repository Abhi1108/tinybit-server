const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { requireActivePlan } = require('../middleware/requireActivePlan.middleware');
const {
  inviteParent,
  respondToInvitation,
  getPendingInvitations,
  getSentInvitations,
  savePushToken,
  guardianElders,
  guardianAlerts,
  guardianLocation,
  guardianReports,
  getConnectedGuardians,
  removeElder,
  getElderSummary,
  getElderDashboard,
  getElderCoGuardians,
  notifyOtherGuardians,
  listElderEmergencyContacts,
  createElderEmergencyContact,
  sendElderReminder,
  listElderMedicines,
  getElderMedicine,
  createElderMedicine,
  updateElderMedicine,
  deleteElderMedicine,
  listElderMedicineLogs,
  getElderMedicineAdherenceWeek,
  listElderHealthRecords,
  createElderHealthRecord,
  deleteElderHealthRecord,
  presignElderUpload,
  presignElderDownload,
} = require('../controllers/guardian.controller');

router.post('/invite',               requireJwtAuth, requireActivePlan, inviteParent);
router.post('/respond',              requireJwtAuth, requireActivePlan, respondToInvitation);
router.get('/pending-invitations',   requireJwtAuth, requireActivePlan, getPendingInvitations);
router.get('/sent-invitations',      requireJwtAuth, requireActivePlan, getSentInvitations);
router.get('/connected-guardians',   requireJwtAuth, requireActivePlan, getConnectedGuardians);
router.post('/save-push-token',      requireJwtAuth, requireActivePlan, savePushToken);

router.get('/elders',                requireJwtAuth, requireActivePlan, guardianElders);
router.delete('/elders/:elderId',    requireJwtAuth, requireActivePlan, removeElder);
router.get('/alerts',                requireJwtAuth, requireActivePlan, guardianAlerts);
router.get('/location',              requireJwtAuth, requireActivePlan, guardianLocation);
router.get('/reports',               requireJwtAuth, requireActivePlan, guardianReports);
router.get('/elders/:elderId/summary',   requireJwtAuth, requireActivePlan, getElderSummary);
router.get('/elders/:elderId/dashboard', requireJwtAuth, requireActivePlan, getElderDashboard);
router.get('/elders/:elderId/co-guardians', requireJwtAuth, requireActivePlan, getElderCoGuardians);
router.post('/elders/:elderId/notify-guardians', requireJwtAuth, requireActivePlan, notifyOtherGuardians);
router.get('/elders/:elderId/emergency-contacts',  requireJwtAuth, requireActivePlan, listElderEmergencyContacts);
router.post('/elders/:elderId/emergency-contacts', requireJwtAuth, requireActivePlan, createElderEmergencyContact);
router.post('/elders/:elderId/send-reminder',       requireJwtAuth, requireActivePlan, sendElderReminder);

router.get('/elders/:elderId/medicines',        requireJwtAuth, requireActivePlan, listElderMedicines);
router.post('/elders/:elderId/medicines',       requireJwtAuth, requireActivePlan, createElderMedicine);
router.get('/elders/:elderId/medicines/logs',   requireJwtAuth, requireActivePlan, listElderMedicineLogs);
router.get('/elders/:elderId/medicines/adherence-week', requireJwtAuth, requireActivePlan, getElderMedicineAdherenceWeek);
// NOTE: /medicines/:id must be registered after the /medicines/logs and /medicines/adherence-week
// literal routes above, or a request to those paths would match :id="logs"/"adherence-week" here instead.
router.get('/elders/:elderId/medicines/:id',    requireJwtAuth, requireActivePlan, getElderMedicine);
router.patch('/elders/:elderId/medicines/:id',  requireJwtAuth, requireActivePlan, updateElderMedicine);
router.delete('/elders/:elderId/medicines/:id', requireJwtAuth, requireActivePlan, deleteElderMedicine);

router.get('/elders/:elderId/health-records',        requireJwtAuth, requireActivePlan, listElderHealthRecords);
router.post('/elders/:elderId/health-records',       requireJwtAuth, requireActivePlan, createElderHealthRecord);
router.delete('/elders/:elderId/health-records/:id', requireJwtAuth, requireActivePlan, deleteElderHealthRecord);

router.post('/elders/:elderId/storage/presign-upload',   requireJwtAuth, requireActivePlan, presignElderUpload);
router.post('/elders/:elderId/storage/presign-download', requireJwtAuth, requireActivePlan, presignElderDownload);

module.exports = router;
